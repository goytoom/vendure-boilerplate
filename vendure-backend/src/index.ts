// src/index.ts
import express from 'express';
import { bootstrap, runMigrations } from '@vendure/core';
import { config } from './vendure-config';

(async () => {
  console.log('index.ts');

  // Create an Express app we control
  const app = express();

  // ✅ Ensure Stripe webhook receives RAW body (Buffer) before any parser runs
  app.use('/stripe-webhook', express.raw({ type: 'application/json' }));

  try {
    await runMigrations(config);
    // Boot Vendure using our preconfigured Express app
    await bootstrap(config, { app });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
