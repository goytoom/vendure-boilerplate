// src/index.ts
import { bootstrap, runMigrations } from '@vendure/core';
import { config } from './vendure-config';

(async () => {
  console.log('index.ts');

  try {
    await runMigrations(config);
    // ✅ Enable Nest's rawBody support so we can read req.rawBody in our webhook
    await bootstrap(config, {
      nestApplicationOptions: {
        rawBody: true,
      },
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
