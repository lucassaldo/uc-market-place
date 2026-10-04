const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
      if (parsed.default) return parsed.default;
    } catch {
      // Fall back to the legacy service-role environment variable.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

class StripeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function getSupabaseAnonKey() {
  return (
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    ""
  );
}

async function stripePost(
  path: string,
  secretKey: string,
  params: URLSearchParams,
  idempotencyKey?: string,
) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    throw new StripeApiError(
      data?.error?.message || `Stripe error ${response.status}`,
      response.status,
    );
  }

  return data;
}

async function stripeGet(path: string, secretKey: string) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Stripe error ${response.status}`);
  }
  return data;
}

async function stripeGetV2(path: string, secretKey: string) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": "2026-08-26.preview",
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Stripe error ${response.status}`);
  }
  return data;
}

async function supabaseGet(
  path: string,
  serviceKey: string,
) {
  const response = await fetch(path, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Supabase error ${response.status}`,
    );
  }

  return data;
}

async function supabaseRpc(
  supabaseUrl: string,
  serviceKey: string,
  functionName: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.details || `Supabase error ${response.status}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = getSupabaseServiceKey();
    const anonKey = getSupabaseAnonKey();

    if (!stripeSecretKey) {
      return json(
        { error: "STRIPE_SECRET_KEY is not configured" },
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
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
        500,
      );
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Authentication required" }, 401);
    }

    const accessToken = authHeader.slice("Bearer ".length);

    // Verify the logged-in buyer.
    const userResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        headers: {
          ...(anonKey ? { apikey: anonKey } : {}),
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!userResponse.ok) {
      return json({ error: "Invalid session" }, 401);
    }

    const user = await userResponse.json();

    if (!user?.id) {
      return json({ error: "Invalid session" }, 401);
    }

    const body = await req.json();
    const purchaseId = body?.purchaseId;

    if (!purchaseId) {
      return json({ error: "purchaseId is required" }, 400);
    }

    // Load the accepted purchase and its listing.
    const purchaseUrl =
      `${supabaseUrl}/rest/v1/purchases` +
      `?id=eq.${encodeURIComponent(String(purchaseId))}` +
      `&buyer_id=eq.${encodeURIComponent(String(user.id))}` +
      `&status=eq.accepted` +
      `&select=id,buyer_id,seller_id,price,payment_method,stripe_checkout_session_id,stripe_checkout_attempt,listing:listings(id,title,price,seller_id,status,removed_at)`;

    const purchases = await supabaseGet(
      purchaseUrl,
      serviceKey,
    );

    const purchase = purchases?.[0];

    if (!purchase) {
      return json(
        { error: "Purchase is not available for payment" },
        400,
      );
    }

    if (purchase.payment_method !== "online") {
      return json({ error: "This purchase is not set up for online payment." }, 400);
    }

    const listing = Array.isArray(purchase.listing)
      ? purchase.listing[0]
      : purchase.listing;

    if (!listing) {
      return json({ error: "Listing not found" }, 400);
    }

    if (
      String(listing.seller_id) !== String(purchase.seller_id) ||
      listing.status !== "Reserved"
    ) {
      return json({ error: "Invalid seller for this purchase" }, 400);
    }

    // Load seller's Stripe Connect account.
    const sellerProfileUrl =
      `${supabaseUrl}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(String(purchase.seller_id))}` +
      `&select=stripe_account_id`;

    const sellerProfiles = await supabaseGet(
      sellerProfileUrl,
      serviceKey,
    );

    const stripeAccountId =
      sellerProfiles?.[0]?.stripe_account_id ?? null;

    if (!stripeAccountId) {
      return json(
        {
          error:
            "The seller has not connected Stripe payments yet.",
        },
        400,
      );
    }

    const sellerAccount = await stripeGet(
      `/v1/accounts/${encodeURIComponent(String(stripeAccountId))}`,
      stripeSecretKey,
    );
    const sellerAccountV2 = await stripeGetV2(
      `/v2/core/accounts/${encodeURIComponent(String(stripeAccountId))}?include=configuration.merchant&include=configuration.recipient`,
      stripeSecretKey,
    );
    const transfersReady =
      sellerAccountV2?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active" ||
      sellerAccount.capabilities?.transfers === "active";
    if (
      sellerAccount.charges_enabled !== true ||
      sellerAccount.payouts_enabled !== true ||
      sellerAccount.capabilities?.card_payments !== "active" ||
      sellerAccountV2?.configuration?.merchant?.capabilities?.card_payments?.status !== "active" ||
      !transfersReady
    ) {
      return json(
        { error: "The seller needs to finish Stripe payments setup before online payment is available." },
        400,
      );
    }

    const rawPrice = String(purchase.price ?? "")
      .replace(/^\$\s*/, "")
      .replace(/,/g, "")
      .trim();

    if (!/^\d+(?:\.\d{1,2})?$/.test(rawPrice)) {
      return json({ error: "Invalid listing price" }, 400);
    }
    const price = Number(rawPrice);

    if (!Number.isFinite(price) || price <= 0) {
      return json({ error: "Invalid listing price" }, 400);
    }

    const priceInCents = Math.round(price * 100);

    if (!Number.isInteger(priceInCents) || priceInCents <= 0) {
      return json({ error: "Invalid listing price" }, 400);
    }


    const appUrl = Deno.env.get("APP_URL");

    if (!appUrl) {
      return json(
        { error: "APP_URL is not configured" },
        500,
      );
    }

    const claim = await supabaseRpc(
      supabaseUrl,
      serviceKey,
      "claim_purchase_checkout",
      { p_purchase_id: purchase.id, p_buyer_id: user.id },
    );

    if (claim?.busy) {
      return json({ error: "Secure Checkout is starting. Please try again in a moment." }, 409);
    }

    let session = claim?.session_id
      ? await stripeGet(
        `/v1/checkout/sessions/${encodeURIComponent(String(claim.session_id))}`,
        stripeSecretKey,
      )
      : null;

    if (session?.status === "expired") {
      await supabaseRpc(
        supabaseUrl,
        serviceKey,
        "expire_purchase_checkout",
        {
          p_purchase_id: purchase.id,
          p_checkout_session_id: session.id,
          p_checkout_attempt: claim.attempt,
        },
      );
      const nextClaim = await supabaseRpc(
        supabaseUrl,
        serviceKey,
        "claim_purchase_checkout",
        { p_purchase_id: purchase.id, p_buyer_id: user.id },
      );
      if (!nextClaim?.create) {
        return json({ error: "Secure Checkout is being updated. Please try again." }, 409);
      }
      claim.attempt = nextClaim.attempt;
      claim.create = true;
      claim.session_id = null;
    } else if (session) {
      if (session.status !== "open" || !session.url) {
        return json({ error: "Payment is already processing. Check My Purchases for its verified status." }, 409);
      }
      return json({ url: session.url, sessionId: session.id });
    }

    if (!claim?.create) {
      return json({ error: "Secure Checkout could not be started. Please try again." }, 409);
    }

    const baseUrl = appUrl.replace(/\/+$/, "");
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(priceInCents));
    params.set(
      "line_items[0][price_data][product_data][name]",
      String(listing.title || `UC Market Listing ${listing.id}`),
    );

    // Leave payment_method_types unset so Checkout uses Stripe's configured dynamic methods.
    params.set("payment_intent_data[transfer_data][destination]", String(stripeAccountId));
    params.set(
      "success_url",
      `${baseUrl}/?payment=success&purchase_id=${encodeURIComponent(String(purchase.id))}&session_id={CHECKOUT_SESSION_ID}`,
    );
    params.set(
      "cancel_url",
      `${baseUrl}/?payment=cancelled&purchase_id=${encodeURIComponent(String(purchase.id))}`,
    );
    params.set("metadata[purchase_id]", String(purchase.id));
    params.set("metadata[listing_id]", String(listing.id));
    params.set("metadata[checkout_attempt]", String(claim.attempt));

    try {
      session = await stripePost(
        "/v1/checkout/sessions",
        stripeSecretKey,
        params,
        `purchase-${purchase.id}-${claim.attempt}`,
      );
    } catch (error) {
      if (
        error instanceof StripeApiError &&
        error.status < 500 &&
        error.status !== 409
      ) {
        await supabaseRpc(
          supabaseUrl,
          serviceKey,
          "release_purchase_checkout_claim",
          {
            p_purchase_id: purchase.id,
            p_buyer_id: user.id,
            p_checkout_attempt: claim.attempt,
          },
        );
      }
      throw error;
    }

    await supabaseRpc(
      supabaseUrl,
      serviceKey,
      "save_purchase_checkout",
      {
        p_purchase_id: purchase.id,
        p_buyer_id: user.id,
        p_checkout_attempt: claim.attempt,
        p_checkout_session_id: session.id,
      },
    );

    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error(error);

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Checkout failed",
      },
      500,
    );
  }
});
