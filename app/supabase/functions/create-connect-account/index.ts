const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getSecretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.default ?? "";
    } catch {
      // fall through
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
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

async function stripeGet(path: string, secretKey: string) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Stripe error ${response.status}`,
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

    if (!stripeSecretKey) {
      return json(
        { error: "STRIPE_SECRET_KEY is not configured" },
        500,
      );
    }

    const authorization = req.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "Authentication required" }, 401);
    }

    const accessToken = authorization.slice("Bearer ".length);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!supabaseUrl) {
      return json({ error: "SUPABASE_URL is not configured" }, 500);
    }

    const publishableKeysRaw =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
    let publishableKey = "";

    if (publishableKeysRaw) {
      try {
        const parsed = JSON.parse(publishableKeysRaw);
        publishableKey = parsed.default ?? "";
      } catch {
        // fall through
      }
    }

    if (!publishableKey) {
      publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    }

    if (!publishableKey) {
      return json(
        { error: "Supabase publishable key is not configured" },
        500,
      );
    }

    // Verify the logged-in user.
    const userResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        headers: {
          apikey: publishableKey,
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

    const secretKey = getSecretKey();

    if (!secretKey) {
      return json(
        { error: "Supabase secret key is not configured" },
        500,
      );
    }

    // Read seller's existing Stripe account.
    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(
        user.id,
      )}&select=stripe_account_id`,
      {
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
        },
      },
    );

    if (!profileResponse.ok) {
      throw new Error(
        `Unable to read profile (${profileResponse.status})`,
      );
    }

    const profiles = await profileResponse.json();
    let accountId = profiles?.[0]?.stripe_account_id ?? null;

    // Create Express Connect account when needed.
    if (!accountId) {
      const accountParams = new URLSearchParams();

      accountParams.set("type", "express");

      if (user.email) {
        accountParams.set("email", user.email);
      }

      accountParams.set(
        "capabilities[card_payments][requested]",
        "true",
      );
      accountParams.set(
        "capabilities[transfers][requested]",
        "true",
      );

      const account = await stripePost(
        "/v1/accounts",
        stripeSecretKey,
        accountParams,
      );

      accountId = account.id;

      const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(
          user.id,
        )}`,
        {
          method: "PATCH",
          headers: {
            apikey: secretKey,
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            stripe_account_id: accountId,
          }),
        },
      );

      if (!updateResponse.ok) {
        throw new Error(
          `Unable to save Stripe account (${updateResponse.status})`,
        );
      }
    }

    const account = await stripeGet(
      `/v1/accounts/${encodeURIComponent(accountId)}`,
      stripeSecretKey,
    );

    if (account.charges_enabled && account.payouts_enabled) {
      return json({
        connected: true,
        accountId,
      });
    }

    const appUrl = Deno.env.get("APP_URL");

    if (!appUrl) {
      return json({ error: "APP_URL is not configured" }, 500);
    }

    const linkParams = new URLSearchParams();

    linkParams.set("account", accountId);
    linkParams.set(
      "refresh_url",
      `${appUrl}/?connect=refresh`,
    );
    linkParams.set(
      "return_url",
      `${appUrl}/?connect=complete`,
    );
    linkParams.set("type", "account_onboarding");

    const accountLink = await stripePost(
      "/v1/account_links",
      stripeSecretKey,
      linkParams,
    );

    return json({
      connected: false,
      accountId,
      onboardingUrl: accountLink.url,
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create Connect account",
      },
      500,
    );
  }
});
