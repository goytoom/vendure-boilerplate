// app/routes/membership.tsx
import { json, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getActiveCustomerDetails } from "~/providers/customer/customer";

// Map your price IDs (make sure these match the mode you're using: test vs live)
const BASIC_PRICES = new Set<string>([
  "price_1S1uaNEtQNaz1Lwt8utBuui7", // Basic monthly
  "price_1S1uZfEtQNaz1LwtlEDzLUQT", // Basic yearly
]);
const PREMIUM_PRICES = new Set<string>([
  "price_1S1uagEtQNaz1LwtffKeFBWO", // Premium monthly
  "price_1S1ua7EtQNaz1LwtSt8ENogi", // Premium yearly
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const dbg = url.searchParams.get("dbg") === "1"; // show debug in page when ?dbg=1

  const { activeCustomer } = await getActiveCustomerDetails({ request });
  if (!activeCustomer) return redirect("/sign-in");

  let membershipStatus: "none" | "basic" | "premium" = "none";

  // debug accumulator we can show in UI (only when dbg=1)
  const debug: Record<string, any> = {
    step: "start",
    vendureCustomerId: activeCustomer.id,
    email: activeCustomer.emailAddress,
  };

  try {
    const { default: Stripe } = await import("stripe");
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY missing");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-08-16" });

    // 1) Try metadata match
    let stripeCustomer: import("stripe").Stripe.Customer | null = null;
    try {
      const byMeta = await stripe.customers.search({
        query: `metadata['vendureCustomerId']:'${activeCustomer.id}'`,
        limit: 1,
      });
      stripeCustomer = byMeta.data[0] ?? null;
      debug.byMetaFound = !!stripeCustomer;
      debug.byMetaCustomerId = stripeCustomer?.id ?? null;
    } catch (e: any) {
      debug.byMetaError = e?.message || String(e);
      // continue to email match
    }

    // 2) Fallback: email match
    if (!stripeCustomer) {
      const byEmail = await stripe.customers.list({ email: activeCustomer.emailAddress, limit: 1 });
      stripeCustomer = byEmail.data[0] ?? null;
      debug.byEmailFound = !!stripeCustomer;
      debug.byEmailCustomerId = stripeCustomer?.id ?? null;
    }

    if (!stripeCustomer) {
      debug.step = "no-stripe-customer";
      console.log("[membership] no stripe customer found for", activeCustomer.id, activeCustomer.emailAddress);
    } else {
      debug.step = "found-customer";

      // 3) Check subscriptions
      const subs = await stripe.subscriptions.list({
        customer: stripeCustomer.id,
        status: "all",
        expand: ["data.items.price"],
        limit: 10,
      });

      debug.subCount = subs.data.length;
      debug.subStatuses = subs.data.map(s => ({ id: s.id, status: s.status }));

      // Consider active or trialing as "member"
      const activeLike = subs.data.find(s => s.status === "active" || s.status === "trialing");
      debug.activeLike = !!activeLike;
      debug.activeLikeStatus = activeLike?.status ?? null;

      if (activeLike) {
        const priceId = activeLike.items.data[0]?.price?.id || null;
        debug.matchedPriceId = priceId;

        if (priceId && BASIC_PRICES.has(priceId)) {
          membershipStatus = "basic";
        } else if (priceId && PREMIUM_PRICES.has(priceId)) {
          membershipStatus = "premium";
        } else {
          // If you don't care about tier, treat any active sub as at least "basic"
          membershipStatus = "basic";
        }
      } else {
        // Not active/trialing
        membershipStatus = "none";
      }
    }
  } catch (e: any) {
    debug.step = "stripe-error";
    debug.error = e?.message || String(e);
    console.warn("[membership] stripe error:", debug.error);
    // fall back to none
  }

  // Always log the summary to server logs
  console.log("[membership] decision", {
    vendureCustomerId: activeCustomer.id,
    email: activeCustomer.emailAddress,
    status: membershipStatus,
    summary: {
      step: debug.step,
      byMetaFound: debug.byMetaFound,
      byEmailFound: debug.byEmailFound,
      stripeCustomerId: debug.byMetaCustomerId ?? debug.byEmailCustomerId ?? null,
      subCount: debug.subCount,
      subStatuses: debug.subStatuses,
      matchedPriceId: debug.matchedPriceId,
      error: debug.error,
    },
  });

  return json({
    activeCustomer,
    membershipStatus,
    pricingTableId: process.env.PUBLIC_STRIPE_PRICING_TABLE_ID!,
    publishableKey: process.env.PUBLIC_STRIPE_KEY!,
    portalUrl: process.env.PUBLIC_STRIPE_PORTAL_URL!,
    __debug: dbg ? debug : undefined, // only expose in UI when dbg=1
  });
}

export default function MembershipPage() {
  const { activeCustomer, membershipStatus, pricingTableId, publishableKey, portalUrl, __debug } =
    useLoaderData<typeof loader>();

  if (membershipStatus !== "none") {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h2 className="text-2xl font-semibold mb-4">Manage your membership</h2>
        <a href={portalUrl} className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
          Open Stripe Customer Portal
        </a>

        {__debug && (
          <pre className="mt-6 text-left text-xs bg-neutral-100 p-3 rounded">
            {JSON.stringify(__debug, null, 2)}
          </pre>
        )}
      </div>
    );
  }

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
      {__debug && (
        <pre className="mt-6 text-left text-xs bg-neutral-100 p-3 rounded">
          {JSON.stringify(__debug, null, 2)}
        </pre>
      )}
    </div>
  );
}
