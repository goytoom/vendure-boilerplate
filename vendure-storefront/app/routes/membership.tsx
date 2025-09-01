import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/server-runtime";

export async function loader() {
  return json({
    publishableKey: process.env.PUBLIC_STRIPE_KEY,
    pricingTableId: process.env.PUBLIC_STRIPE_PRICING_TABLE_ID,
  });
}

export default function MembershipPage() {
  const { publishableKey, pricingTableId } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl mb-6">Choose your membership</h1>
      <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
      <stripe-pricing-table
        pricing-table-id={pricingTableId}
        publishable-key={publishableKey}
      />
    </div>
  );
}
