import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import Stripe from "stripe";

// 1. Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan"); // e.g. "basic" or "premium"

  if (!plan) {
    throw new Response("Missing plan", { status: 400 });
  }

  // 2. Map plan → Stripe price IDs
  const priceMap: Record<string, string> = {
    basic: "price_basic_monthly_id",   // replace with real Stripe Price ID
    premium: "price_premium_monthly_id",
  };

  const priceId = priceMap[plan];
  if (!priceId) {
    throw new Response("Invalid plan", { status: 400 });
  }

  // TODO: fetch Vendure customer ID & map to Stripe customer
  // For now, we’ll let Stripe create a new customer if not provided.
  // Later you should pass `customer: stripeCustomerId` if it exists.

  // 3. Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: "https://your-storefront-domain/account?success=true",
    cancel_url: "https://your-storefront-domain/membership?canceled=true",
  });

  // 4. Redirect user to Stripe Checkout
  return redirect(session.url!);
}
