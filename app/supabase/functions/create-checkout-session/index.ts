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
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Stripe error ${response.status}`,
    );
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
      `&select=id,buyer_id,seller_id,price,listing:listings(id,title,price,seller_id)`;

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

    const listing = Array.isArray(purchase.listing)
      ? purchase.listing[0]
      : purchase.listing;

    if (!listing) {
      return json({ error: "Listing not found" }, 400);
    }

    if (String(listing.seller_id) !== String(purchase.seller_id)) {
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

    const rawPrice = String(
      listing.price ?? purchase.price ?? "",
    ).replace(/[^0-9.]/g, "");

    const price = Number(rawPrice);

    if (!Number.isFinite(price) || price <= 0) {
      return json({ error: "Invalid listing price" }, 400);
    }

    const priceInCents = Math.round(price * 100);

    if (!Number.isInteger(priceInCents) || priceInCents <= 0) {
      return json({ error: "Invalid listing price" }, 400);
    }

    // UC Market commission: exactly 5%.
    const applicationFeeAmount = Math.round(
      priceInCents * 0.05,
    );

    const appUrl = Deno.env.get("APP_URL");

    if (!appUrl) {
      return json(
        { error: "APP_URL is not configured" },
        500,
      );
    }

    const params = new URLSearchParams();

    params.set("mode", "payment");

    params.set("line_items[0][quantity]", "1");
    params.set(
      "line_items[0][price_data][currency]",
      "usd",
    );
    params.set(
      "line_items[0][price_data][unit_amount]",
      String(priceInCents),
    );
    params.set(
      "line_items[0][price_data][product_data][name]",
      String(
        listing.title ||
          `UC Market Listing ${listing.id}`,
      ),
    );

    // 5% stays with UC Market; the remainder is transferred
    // to the connected seller.
    params.set(
      "payment_intent_data[application_fee_amount]",
      String(applicationFeeAmount),
    );

    params.set(
      "payment_intent_data[transfer_data][destination]",
      String(stripeAccountId),
    );

    params.set(
      "success_url",
      `${appUrl}/?payment=success`,
    );

    params.set(
      "cancel_url",
      `${appUrl}/?payment=cancelled`,
    );

    params.set(
      "metadata[purchase_id]",
      String(purchase.id),
    );

    params.set(
      "metadata[listing_id]",
      String(listing.id),
    );

    const session = await stripePost(
      "/v1/checkout/sessions",
      stripeSecretKey,
      params,
    );

    return json({
      url: session.url,
      sessionId: session.id,
    });
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
