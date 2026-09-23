import Stripe from "npm:stripe@17.7.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
});

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { priceInCents, listingId, title } = await req.json();

    if (!Number.isInteger(priceInCents) || priceInCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid price" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const appUrl = Deno.env.get("APP_URL");

    if (!appUrl) {
      return new Response(
        JSON.stringify({ error: "APP_URL is not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: priceInCents,
            product_data: {
              name: title || `UC Market Listing ${listingId ?? ""}`,
            },
          },
        },
      ],
      success_url: `${appUrl}/?payment=success`,
      cancel_url: `${appUrl}/?payment=cancelled`,
      metadata: {
        listing_id: String(listingId ?? ""),
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Checkout failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
