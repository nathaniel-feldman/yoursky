#!/usr/bin/env node
// Copies the app's engine and config into the Edge Functions so the server scores schools with exactly the same code.
// Run after changing app/src/engine.js or app/src/config.js (npm run build does it automatically); a test fails if the
// copies drift.
import { copyFileSync } from 'node:fs';

for (const f of ['engine.js', 'config.js']) copyFileSync(`app/src/${f}`, `supabase/functions/_shared/app/${f}`);
console.log('Synced engine.js and config.js into supabase/functions/_shared/app/');
