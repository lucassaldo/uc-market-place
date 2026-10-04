const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getSupabaseServiceKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.default ?? "";
    } catch {
      // fallback below
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  webhookSecret: string,
) {
  const parts = signatureHeader.split(",");

  const timestamp = parts.find((part) => part.startsWith("t="))
    ?.slice(2);

  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const timestampNumber = Number(timestamp);

  if (!Number.isFinite(timestampNumber)) {
    return false;
  }

  const age = Math.abs(
    Math.floor(Date.now() / 1000) - timestampNumber,
  );

  if (age > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );

  const expected = hex(new Uint8Array(digest));

  return signatures.some((signature) =>
    safeEqual(signature, expected)
  );
}

async function supabaseRpc(
  url: string,
  serviceKey: string,
  functionName: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const message = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase payment update failed (${response.status}): ${message}`,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = getSupabaseServiceKey();

    if (!webhookSecret) {
      return json(
        { error: "STRIPE_WEBHOOK_SECRET is not configured" },
        500,
      );
    }

    if (!supabaseUrl) {
      return json(
        { error: "SUPABASE_URL is not configured" },
        500,
      );
    }

    if (!serviceKey) {
      return json(
        { error: "Supabase service key is not configured" },
        500,
      );
    }

    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return json({ error: "Missing Stripe signature" }, 400);
    }

    const body = await req.text();

    const valid = await verifyStripeSignature(
      body,
      signature,
      webhookSecret,
    );

    if (!valid) {
      return json({ error: "Invalid Stripe signature" }, 400);
    }

    const event = JSON.parse(body);

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data?.object;
      const purchaseId = session?.metadata?.purchase_id;
      const listingId = session?.metadata?.listing_id;
      if (session?.payment_status !== "paid") {
        return json({ received: true });
      }
      if (!purchaseId || !listingId || !session?.id) {
        throw new Error("Paid Checkout session is missing purchase metadata");
      }

      const paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
      await supabaseRpc(
          supabaseUrl,
          serviceKey,
          "complete_online_purchase",
          {
            p_purchase_id: String(purchaseId),
            p_listing_id: Number(listingId),
            p_checkout_session_id: String(session.id),
            p_payment_intent_id: paymentIntentId,
          },
        );
    }

    if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const session = event.data?.object;
      const purchaseId = session?.metadata?.purchase_id;
      if (purchaseId && session?.id) {
        const attempt = Number(session.metadata?.checkout_attempt);
        await supabaseRpc(
          supabaseUrl,
          serviceKey,
          "expire_purchase_checkout",
          {
            p_purchase_id: String(purchaseId),
            p_checkout_session_id: String(session.id),
            p_checkout_attempt: Number.isInteger(attempt) ? attempt : null,
          },
        );
      }
    }

    return json({ received: true });
  } catch (error) {
    console.error(error);

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Webhook processing failed",
      },
      400,
    );
  }
});
