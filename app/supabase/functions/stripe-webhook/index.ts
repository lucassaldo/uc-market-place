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

async function supabasePatch(
  url: string,
  serviceKey: string,
  filter: string,
  body: unknown,
) {
  const response = await fetch(`${url}${filter}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Supabase update failed (${response.status}): ${message}`,
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

    if (event.type === "checkout.session.completed") {
      const session = event.data?.object;

      const purchaseId = session?.metadata?.purchase_id;
      const listingId = session?.metadata?.listing_id;

      if (purchaseId) {
        await supabasePatch(
          supabaseUrl,
          serviceKey,
          `/rest/v1/purchases?id=eq.${encodeURIComponent(
            String(purchaseId),
          )}`,
          { status: "completed" },
        );
      }

      if (listingId) {
        await supabasePatch(
          supabaseUrl,
          serviceKey,
          `/rest/v1/listings?id=eq.${encodeURIComponent(
            String(listingId),
          )}`,
          { status: "Sold" },
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
