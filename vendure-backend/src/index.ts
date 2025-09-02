// src/index.ts
import { bootstrap, runMigrations, CustomerService, ChannelService, CustomerGroupService } from '@vendure/core';
import { config } from './vendure-config';
import { setAppServices } from './app-services';

(async () => {
  console.log('index.ts');

  try {
    await runMigrations(config);

    const nestApp = await bootstrap(config, {
      nestApplicationOptions: { rawBody: true }, // keep this for Stripe signatures
    });

    // ✅ Resolve concrete services from the Nest app and store them
    const customerService = nestApp.get(CustomerService);
    const channelService = nestApp.get(ChannelService);
    const customerGroupService = nestApp.get(CustomerGroupService);

    setAppServices({ customerService, channelService, customerGroupService });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
