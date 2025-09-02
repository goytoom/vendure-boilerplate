import {
    dummyPaymentHandler,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    VendureConfig,
    ChannelService,
    CustomerService, 
    RequestContext,
    CustomerGroupService,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin, EmailPluginDevModeOptions, EmailPluginOptions } from '@vendure/email-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { StripePlugin } from '@vendure/payments-plugin/package/stripe';
import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';

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

  const allowTest = process.env.STRIPE_WEBHOOK_ALLOW_TEST === 'true';
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (allowTest && !sig) {
    console.log('🧪 Test webhook ping accepted (no signature).');
    res.status(200).send('ok-test');
    return;
  }

  // IMPORTANT: req.body must be a Buffer here
  let event: Stripe.Event;
  try {
    const rawBody = (req as any).body;
    // Optional sanity check:
    // console.log('body is Buffer?', Buffer.isBuffer(rawBody));
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
      const appAny = (req as any).app as any;
      const vendureApp = appAny.get?.('vendureApp');
      const injector = vendureApp?.injector;

      const customerService = injector.get(CustomerService);
      const channelService = injector.get(ChannelService);
      const defaultChannel = await channelService.getDefaultChannel();

      const ctx = new RequestContext({
        apiType: 'admin',
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
        channel: defaultChannel,
      });

      // Try by stripeCustomerId, then by email (if present)
      const found = await customerService.findAll(ctx, {
        filter: { customFields: { stripeCustomerId: { eq: stripeCustomerId } } },
      });
      let customer = found.items[0];

      if (!customer && (subscription as any).customer_email) {
        const byEmail = await customerService.findAll(ctx, {
          filter: { emailAddress: { eq: (subscription as any).customer_email } },
        });
        customer = byEmail.items[0];
      }

      if (customer) {
        const BASIC_PRICES = new Set([
          'price_1S1uaNEtQNaz1Lwt8utBuui7', // Basic monthly
          'price_1S1uZfEtQNaz1LwtlEDzLUQT', // Basic yearly
        ]);
        const PREMIUM_PRICES = new Set([
          'price_1S1uagEtQNaz1LwtffKeFBWO', // Premium monthly
          'price_1S1ua7EtQNaz1LwtSt8ENogi', // Premium yearly
        ]);

        const planPrice = subscription.items.data[0].price.id;
        // IDs of your Customer Groups (check via Admin GraphQL query)
        const BASIC_GROUP_ID = '1';    // change to real ID
        const PREMIUM_GROUP_ID = '2';  // change to real ID

        // Always keep the Stripe customer ID in customFields
        await customerService.update(ctx, {
          id: customer.id,
          customFields: { stripeCustomerId },
        });

        // Access the CustomerGroupService
        const customerGroupService = injector.get(CustomerGroupService);

        // First, remove from both groups to reset
        await customerGroupService.removeCustomersFromGroup(ctx, {
          customerGroupId: BASIC_GROUP_ID,
          customerIds: [customer.id],
        });
        await customerGroupService.removeCustomersFromGroup(ctx, {
          customerGroupId: PREMIUM_GROUP_ID,
          customerIds: [customer.id],
        });

        // Then, if still subscribed, add to the right group
        if (event.type !== 'customer.subscription.deleted') {
          if (BASIC_PRICES.has(planPrice)) {
            await customerGroupService.addCustomersToGroup(ctx, {
              customerGroupId: BASIC_GROUP_ID,
              customerIds: [customer.id],
            });
          } else if (PREMIUM_PRICES.has(planPrice)) {
            await customerGroupService.addCustomersToGroup(ctx, {
              customerGroupId: PREMIUM_GROUP_ID,
              customerIds: [customer.id],
            });
          }
        }


        console.log(
          `✅ Updated ${customer.emailAddress} → groups: ${newGroups.map(g => g.code).join(', ') || '(none)'}`
        );
      } else {
        console.warn(`⚠️ No Vendure customer matched Stripe customer ${stripeCustomerId}`);
      }
    } catch (svcErr: any) {
      console.error('❌ Error handling subscription webhook:', svcErr?.message);
      // Respond 200 anyway to avoid Stripe retries unless you want them
    }
  }

  // Always respond quickly to Stripe
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
              // Force raw body for this route ONLY (needed for Stripe signatures)
              const raw = express.raw({ type: 'application/json' });
              raw(req as any, res as any, (err: any) => {
                if (err) return next(err);
                // Now req.body is a Buffer. Call the core handler.
                handleStripeWebhookCore(req, res, stripe).catch(next);
              });
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
        logging: false,
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
    customFields: {},
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
