import {
    dummyPaymentHandler,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    VendureConfig,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin, EmailPluginDevModeOptions, EmailPluginOptions } from '@vendure/email-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { StripePlugin } from '@vendure/payments-plugin/package/stripe';
import 'dotenv/config';
import path from 'path';
import express, { Request, Response } from 'express';
import Stripe from 'stripe';
import { CustomerService, RequestContext } from '@vendure/core';

// --- STRIPE CLIENT (for subscriptions only) ---
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const isDev: Boolean = process.env.APP_ENV === 'dev';

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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
		    handler: [
		      express.raw({ type: 'application/json' }),
		      async (req: Request, res: Response) => {
		        let event: Stripe.Event;

		        try {
		          const sig = req.headers['stripe-signature'] as string;
		          event = stripe.webhooks.constructEvent(
		            req.body,
		            sig,
		            process.env.STRIPE_WEBHOOK_SECRET!
		          );
		        } catch (err: any) {
		          res.status(400).send(`Webhook Error: ${err.message}`);
		          return;
		        }

		        const subscriptionEvents = [
		          'customer.subscription.created',
		          'customer.subscription.updated',
		          'customer.subscription.deleted',
		        ];

		        if (subscriptionEvents.includes(event.type)) {
		          const subscription = event.data.object as Stripe.Subscription;
		          const stripeCustomerId = subscription.customer as string;

		          // Vendure services
		          const app = req.app as any;
		          const vendureApp = app.get('vendureApp');
		          const injector = vendureApp.injector;
		          const customerService = injector.get(CustomerService);
		          const ctx = new RequestContext({
		            apiType: 'admin',
		            isAuthorized: true,
		            authorizedAsOwnerOnly: false,
		          });

		          // Try to find Vendure customer with this stripeCustomerId
		          const customers = await customerService.findAll(ctx, {
		            filter: { customFields: { stripeCustomerId: { eq: stripeCustomerId } } },
		          });

		          let customer = customers.items[0];

		          // Fallback: match by email if available
		          if (!customer && (subscription as any).customer_email) {
		            const byEmail = await customerService.findAll(ctx, {
		              filter: { emailAddress: { eq: (subscription as any).customer_email } },
		            });
		            customer = byEmail.items[0];
		          }

		          if (customer) {
		            // 🎯 Define your Stripe Price IDs
		            const basicPrices = [
		              'price_1S1uaNEtQNaz1Lwt8utBuui7', // Basic monthly
		              'price_1S1uZfEtQNaz1LwtlEDzLUQT', // Basic yearly
		            ];
		            const premiumPrices = [
		              'price_1S1uagEtQNaz1LwtffKeFBWO', // Premium monthly
		              'price_1S1ua7EtQNaz1LwtSt8ENogi', // Premium yearly
		            ];

		            const planPrice = subscription.items.data[0].price.id;
		            let newGroups: { code: string }[] = [];

		            if (event.type === 'customer.subscription.deleted') {
		              newGroups = []; // remove all memberships
		            } else if (basicPrices.includes(planPrice)) {
		              newGroups = [{ code: 'basic' }];
		            } else if (premiumPrices.includes(planPrice)) {
		              newGroups = [{ code: 'premium' }];
		            }

		            // Update customer with Stripe ID + groups
		            await customerService.update(ctx, {
		              id: customer.id,
		              customFields: { stripeCustomerId },
		              groups: newGroups,
		            });

		            console.log(
		              `✅ Updated customer ${customer.emailAddress} → groups: ${newGroups.map(
		                g => g.code
		              )}`
		            );
		          } else {
		            console.log(`⚠️ No Vendure customer found for Stripe customer ${stripeCustomerId}`);
		          }
		        }

		        res.json({ received: true });
		      },
		    ],
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
    customFields: {
	  Customer: [
	    { name: 'stripeCustomerId', type: 'string', nullable: true },
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
