// src/index.ts
import { bootstrap, runMigrations, Injector } from '@vendure/core';
import { config } from './vendure-config';
import { setAppInjector } from './app-injector';

(async () => {
  console.log('index.ts');

  try {
    await runMigrations(config);
    const nestApp = await bootstrap(config, {
      nestApplicationOptions: { rawBody: true }, // ✅ keep this
    });

    // ✅ Capture Vendure's DI container for use in your webhook
    const injector = nestApp.get(Injector);
    setAppInjector(injector);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
