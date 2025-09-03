import {
    dummyPaymentHandler,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    VendureConfig,
    RequestContext,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin, EmailPluginDevModeOptions, EmailPluginOptions } from '@vendure/email-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { StripePlugin } from '@vendure/payments-plugin/package/stripe';
import 'dotenv/config';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { getAppServices } from './app-services';

console.log("🚀 vendure-config.ts LOADED at", new Date().toISOString());

// --- STRIPE CLIENT (for subscriptions only) ---
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-08-16' });

const isDev: Boolean = process.env.APP_ENV === 'dev';
const sgMail = require('@sendgrid/mail');
const sgKey = process.env.SENDGRID_API_KEY;
if (sgKey && sgKey.startsWith('SG.')) {
  sgMail.setApiKey(sgKey);
} else {
  console.warn('SendGrid key missing or malformed; EmailPlugin will run in devMode mailbox.');
}

async function handleStripeWebhookCore(req: Request, res: Response, stripe: Stripe) {
  console.log('🔥 Stripe webhook hit');

  console.log(
    'stripe-webhook debug:',
    'rawIsBuffer=', Buffer.isBuffer((req as any).rawBody),
    'rawType=', typeof (req as any).rawBody,
    'bodyIsBuffer=', Buffer.isBuffer((req as any).body),
    'bodyType=', typeof (req as any).body
  );

  const allowTest = process.env.STRIPE_WEBHOOK_ALLOW_TEST === 'true';
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (allowTest && !sig) {
    console.log('🧪 Test webhook ping accepted (no signature).');
    res.status(200).send('ok-test');
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBody = (req as any).rawBody as Buffer | string | undefined;
    if (!rawBody) {
      console.error('❌ rawBody missing. Ensure rawBody: true in bootstrap()');
      res.status(400).send('Webhook Error: rawBody missing');
      return;
    }

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('❌ Webhook signature verification failed:', err?.message);
    res.status(400).send(`Webhook Error: ${err?.message}`);
    return;
  }

  const subscriptionEvents = new Set([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ]);

  if (subscriptionEvents.has(event.type)) {
    const subscription = event.data.object as Stripe.Subscription;
    const stripeCustomerId = subscription.customer as string;

    try {
      const { customerService, channelService, customerGroupService } = getAppServices();
      const defaultChannel = await channelService.getDefaultChannel();

      const ctx = new RequestContext({
        apiType: 'admin',
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
        channel: defaultChannel,
      });

      // ---------- NEW LOOKUP BLOCK (metadata-first, then email) ----------
      let customer: any = undefined;
      let vendureCustomerIdFromMeta: string | undefined = undefined;

      try {
        const stripeCust = await stripe.customers.retrieve(stripeCustomerId);
        if (stripeCust && (stripeCust as Stripe.Customer).metadata) {
          vendureCustomerIdFromMeta = (stripeCust as Stripe.Customer).metadata['vendureCustomerId'] as string | undefined;
        }
      } catch (e) {
        console.warn('⚠️ Could not retrieve Stripe customer:', (e as any)?.message);
      }

      if (vendureCustomerIdFromMeta) {
        try {
          customer = await customerService.findOne(ctx, vendureCustomerIdFromMeta);
        } catch (e) {
          console.warn('⚠️ Could not fetch Vendure customer by id from metadata:', (e as any)?.message);
        }
      }

      if (!customer) {
        let customerEmail: string | undefined = (subscription as any)?.customer_email;
        if (!customerEmail) {
          try {
            const stripeCust = await stripe.customers.retrieve(stripeCustomerId);
            if (stripeCust && (stripeCust as Stripe.Customer).email) {
              customerEmail = (stripeCust as Stripe.Customer).email!;
            }
          } catch (e) {
            console.warn('⚠️ Could not fetch Stripe customer to resolve email:', (e as any)?.message);
          }
        }

        if (customerEmail) {
          const byEmail = await customerService.findAll(ctx, {
            filter: { emailAddress: { eq: customerEmail } },
          });
          customer = byEmail.items[0];
        }
      }

      if (!customer) {
        console.warn(`⚠️ No Vendure customer matched metadata/email for Stripe customer ${stripeCustomerId}`);
        res.json({ received: true });
        return;
      }

      // Write our Vendure id into Stripe metadata for future deterministic mapping
      try {
        await stripe.customers.update(stripeCustomerId, {
          metadata: { vendureCustomerId: customer.id },
        });
      } catch (e) {
        console.warn('⚠️ Could not update Stripe customer metadata with vendureCustomerId:', (e as any)?.message);
      }
      // ---------- END NEW LOOKUP BLOCK ----------

      const BASIC_PRICES = new Set([
        'price_1S1uaNEtQNaz1Lwt8utBuui7', // Basic monthly
        'price_1S1uZfEtQNaz1LwtlEDzLUQT', // Basic yearly
      ]);
      const PREMIUM_PRICES = new Set([
        'price_1S1uagEtQNaz1LwtffKeFBWO', // Premium monthly
        'price_1S1ua7EtQNaz1LwtSt8ENogi', // Premium yearly
      ]);

      const items = subscription.items?.data ?? [];
      const planPrice = items[0]?.price?.id;

      if (!planPrice) {
        console.warn('⚠️ Subscription event without planPrice; acknowledging.');
        res.json({ received: true });
        return;
      }

      const BASIC_GROUP_ID = '1';   // TODO: set your real id
      const PREMIUM_GROUP_ID = '2'; // TODO: set your real id

      // Safe removal helper: ignore "not in group" style errors
      async function safeRemoveFromGroup(groupId: string, custId: string) {
        try {
          await customerGroupService.removeCustomersFromGroup(ctx, {
            customerGroupId: groupId,
            customerIds: [custId],
          });
        } catch (err: any) {
          // Vendure throws if the customer wasn't in the group; that's fine for our reset step.
          console.warn(`(safeRemove) ignore: ${err?.message || err}`);
        }
      }

      // Keep your Stripe id on the Vendure side for reference
      // await customerService.update(ctx, {
      //   id: customer.id,
      //   customFields: { stripeCustomerId },
      // });

      // First, try to remove from both groups to reset (won't explode if not a member)
      await safeRemoveFromGroup(BASIC_GROUP_ID, customer.id);
      await safeRemoveFromGroup(PREMIUM_GROUP_ID, customer.id);

      // Eligibility by status
      const status = subscription.status; // 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | ...
      const eligible = status === 'active' || status === 'trialing';

      if (!eligible) {
        console.log(`ℹ️ Subscription ${subscription.id} is ${status}; leaving user in no group.`);
        res.json({ received: true });
        return;
      }

      // Add to the right group
      let groupApplied: 'basic' | 'premium' | 'none' = 'none';

      if (event.type !== 'customer.subscription.deleted') {
        if (BASIC_PRICES.has(planPrice)) {
          await customerGroupService.addCustomersToGroup(ctx, {
            customerGroupId: BASIC_GROUP_ID,
            customerIds: [customer.id],
          });
          groupApplied = 'basic';
        } else if (PREMIUM_PRICES.has(planPrice)) {
          await customerGroupService.addCustomersToGroup(ctx, {
            customerGroupId: PREMIUM_GROUP_ID,
            customerIds: [customer.id],
          });
          groupApplied = 'premium';
        }
      }

      // write it into the custom field so Shop API can expose it
      try {
        await customerService.update(ctx, {
          id: customer.id,
          customFields: {
            Membershiptier: groupApplied === 'none' ? null : groupApplied,
          },
        });
      } catch (e: any) {
        console.warn('⚠️ Could not update Membershiptier field:', e?.message);
      }

      console.log(`✅ Updated ${customer.emailAddress} → group: ${groupApplied}`);
    } catch (svcErr: any) {
      console.error('❌ Error handling subscription webhook:', svcErr?.message);
      // Still 200 to avoid aggressive retries
    }
  }

  res.json({ received: true });
}


class SendgridEmailSender {
    async send(email: any) {
        await sgMail.send({
            to: email.recipient,
            from: email.from,
            subject: email.subject,
            html: email.body
        });
    }
}

const emailPluginOptions = isDev || !process.env.SENDGRID_API_KEY ? {
    devMode: true,
    outputPath: path.join(__dirname, '../static/email/test-emails'),
    route: 'mailbox'
} : {
    emailSender: new SendgridEmailSender(),
    transport: {
        type: 'sendgrid',
        apiKey: process.env.SENDGRID_API_KEY
    }
};

export const config: VendureConfig = {
    apiOptions: {
        // hostname: process.env.PUBLIC_DOMAIN,
        port: +(process.env.PORT || 3000),
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        // The following options are useful in development mode,
        // but are best turned off for production for security
        // reasons.
        ...(isDev ? {
            adminApiPlayground: {
                settings: { 'request.credentials': 'include' },
            },
            adminApiDebug: true,
            shopApiPlayground: {
                settings: { 'request.credentials': 'include' },
            },
            shopApiDebug: true,
        } : {}),
            middleware: [
            {
              route: '/stripe-webhook',
              handler: (req: Request, res: Response, next: NextFunction) => {
                // req.body is already a Buffer thanks to index.ts
                handleStripeWebhookCore(req, res, stripe).catch(next);
              },
            },
          ],
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
        },
        cookieOptions: {
            secret: process.env.COOKIE_SECRET,
        },
    },
    dbConnectionOptions: {
        type: 'postgres',
        migrations: [path.join(__dirname, './migrations/*.+(js|ts)')],
        // logging: false,
        logging: ['query', 'error'],
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
        host: process.env.DB_HOST,
        port: +process.env.DB_PORT,
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    // When adding or altering custom field definitions, the database will
    // need to be updated. See the "Migrations" section in README.md.
    customFields: {
    Customer: [
      {
        name: 'Membershiptier',
        type: 'string',
        nullable: true,
        public: true,        // <-- exposes in Shop API
      },
    ],
  },
    plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: process.env.ASSET_VOLUME_PATH || path.join(__dirname, '../static/assets'),
            // For local dev, the correct value for assetUrlPrefix should
            // be guessed correctly, but for production it will usually need
            // to be set manually to match your production url.
            assetUrlPrefix: isDev ? undefined : `https://${process.env.PUBLIC_DOMAIN}/assets/`,
        }),
        StripePlugin.init({
            storeCustomersInStripe: true,
            paymentIntentCreateParams: (injector, ctx, order) => {
                return {
                    description: `Order #${order.code} for ${order.customer?.emailAddress}`
                };
            }
        }),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        EmailPlugin.init({
            ...emailPluginOptions,
            handlers: defaultEmailHandlers,
            templatePath: path.join(__dirname, '../static/email/templates'),
            globalTemplateVars: {
                fromAddress: process.env.EMAIL_FROM_ADDRESS || '"example" <noreply@example.com>',
                verifyEmailAddressUrl: `${process.env.STOREFRONT_URL}/verify`,
                passwordResetUrl: `${process.env.STOREFRONT_URL}/password-reset`,
                changeEmailAddressUrl: `${process.env.STOREFRONT_URL}/verify-email-address-change`
            },
        } as EmailPluginOptions | EmailPluginDevModeOptions),
        AdminUiPlugin.init({
            route: 'admin',
            port: 3002,
            adminUiConfig: {
                apiHost: isDev ? `http://${process.env.PUBLIC_DOMAIN}` : `https://${process.env.PUBLIC_DOMAIN}`,
                // apiPort: +(process.env.PORT || 3000),
            },
        }),
    ],
};
