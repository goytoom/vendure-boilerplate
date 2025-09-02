import { useLoaderData } from "@remix-run/react";
import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getActiveCustomerDetails } from "~/providers/customer/customer";

export async function loader({ request }: LoaderFunctionArgs) {
  const { activeCustomer } = await getActiveCustomerDetails({ request });
  if (!activeCustomer) {
    return redirect("/sign-in");
  }

  // Check membership groups
  const groupIds = (activeCustomer.groups ?? []).map((g: { id: string }) => g.id);
  let membershipStatus: 'none' | 'basic' | 'premium' = 'none';

  console.log("Group IDs:", groupIds);
  console.log("Initial membershipStatus:", membershipStatus);
  if (groupIds.includes("2")) {
    membershipStatus = "premium";
  } else if (groupIds.includes("1")) {
    membershipStatus = "basic";
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

  // If already a member → go to Stripe Portal
  if (membershipStatus !== "none") {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h2 className="text-2xl font-semibold mb-4">Manage your membership</h2>
        <a
          href={portalUrl}
          className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          Open Stripe Customer Portal
        </a>
      </div>
    );
  }

  // If not a member → show Stripe Pricing Table
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h2 className="text-3xl font-semibold mb-6">Choose your membership</h2>
      <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
      <stripe-pricing-table
        pricing-table-id={pricingTableId}
        publishable-key={publishableKey}
        customer-email={activeCustomer.emailAddress}
        client-reference-id={activeCustomer.id}
      >
      </stripe-pricing-table>
    </div>
  );
}
