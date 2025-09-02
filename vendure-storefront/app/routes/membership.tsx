import { json, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import Stripe from "stripe";
import { getActiveCustomerDetails } from "~/providers/customer/customer";

const BASIC_PRICES = new Set<string>([
  "price_1S1uaNEtQNaz1Lwt8utBuui7", // Basic monthly
  "price_1S1uZfEtQNaz1LwtlEDzLUQT", // Basic yearly
]);

const PREMIUM_PRICES = new Set<string>([
  "price_1S1uagEtQNaz1LwtffKeFBWO", // Premium monthly
  "price_1S1ua7EtQNaz1LwtSt8ENogi", // Premium yearly
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const { activeCustomer } = await getActiveCustomerDetails({ request });
  if (!activeCustomer) return redirect("/sign-in");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-08-16" });

  // 1) Prefer metadata match
  let stripeCustomer: Stripe.Customer | null = null;
  try {
    const byMeta = await stripe.customers.search({
      // requires Stripe "customer search" (most accounts have it)
      query: `metadata['vendureCustomerId']:'${activeCustomer.id}'`,
      limit: 1,
    });
    stripeCustomer = byMeta.data[0] ?? null;
  } catch {
    // ignore; fall through to email
  }

  // 2) Fallback: email match
  if (!stripeCustomer) {
    const byEmail = await stripe.customers.list({
      email: activeCustomer.emailAddress,
      limit: 1,
    });
    stripeCustomer = byEmail.data[0] ?? null;
  }

  // Decide membership by active/trialing subscription
  let membershipStatus: "none" | "basic" | "premium" = "none";

  if (stripeCustomer) {
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomer.id,
      status: "all",
      expand: ["data.items.price"],
      limit: 10,
    });
    const activeLike = subs.data.find(s => s.status === "active" || s.status === "trialing");
    if (activeLike) {
      const priceId = activeLike.items.data[0]?.price?.id;
      if (priceId && BASIC_PRICES.has(priceId)) membershipStatus = "basic";
      else if (priceId && PREMIUM_PRICES.has(priceId)) membershipStatus = "premium";
      else membershipStatus = "basic"; // fallback if tier unknown
    }
  }

  return json({
    activeCustomer,
    membershipStatus,
    pricingTableId: process.env.PUBLIC_STRIPE_PRICING_TABLE_ID!,
    publishableKey: process.env.PUBLIC_STRIPE_KEY!,
    portalUrl: process.env.PUBLIC_STRIPE_PORTAL_URL!,
  });
}

export default function MembershipPage() {
  const { activeCustomer, membershipStatus, pricingTableId, publishableKey, portalUrl } =
    useLoaderData<typeof loader>();

  // Members → Customer Portal (your existing URL)
  if (membershipStatus !== "none") {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h2 className="text-2xl font-semibold mb-4">Manage your membership</h2>
        <a href={portalUrl} className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
          Open Stripe Customer Portal
        </a>
      </div>
    );
  }

  // Non-members → Pricing Table
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h2 className="text-3xl font-semibold mb-6">Choose your membership</h2>
      <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
      <stripe-pricing-table
        pricing-table-id={pricingTableId}
        publishable-key={publishableKey}
        customer-email={activeCustomer.emailAddress}
        client-reference-id={activeCustomer.id}
      />
    </div>
  );
}
