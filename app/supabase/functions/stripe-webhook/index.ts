import Stripe from "npm:stripe@17.7.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
});

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature || !webhookSecret) {
    return new Response("Missing webhook configuration", { status: 400 });
  }

  try {
    const body = await req.text();

    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        console.log("PAYMENT COMPLETED", {
          sessionId: session.id,
          listingId: session.metadata?.listing_id ?? null,
          amountTotal: session.amount_total ?? null,
        });

        break;
      }

      case "checkout.session.expired":
        console.log("CHECKOUT EXPIRED", event.data.object.id);
        break;

      default:
        console.log("Unhandled event", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response("Webhook error", { status: 400 });
  }
});
