/**
 * Number each brand's actions (AC-01…) and signals (S-01…) from before
 * 00534, brand by brand, so the app shows the brand's own codes instead of
 * the old global ones. New rows are numbered on insert; a brand not yet
 * numbered keeps showing its old codes until this reaches it.
 *
 * Run (from server/):
 *   node src/scripts/backfill-brand-numbers.js [options]
 *
 * Options:
 *   --kind K          action or signal (default both, actions first)
 *   --pause-ms N      wait after each call (default 100)
 *   --brand ID        this brand only, even if it is numbered
 *   --from-brand ID   resume: start at this brand (brands go by id)
 *   --dry-run         print how many calls, call nothing
 *
 * Order on a deploy (the PR that brought 00534 has the runbook): 00534,
 * this with --dry-run, this, then the unique indexes, built by hand.
 *
 * Safe to stop and run again: a call numbers only rows without a number and
 * a run skips the brands already numbered. On a failure it prints the
 * --kind and --from-brand to resume with, and exits 1.
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import supabaseAdmin from '../config/supabase.js';
import {
  BRAND_NUMBER_KINDS,
  BRAND_NUMBERS_PAUSE_MS,
  backfillBrandNumbers,
} from '../lib/brand-numbers-backfill.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function options() {
  const { values } = parseArgs({
    options: {
      kind: { type: 'string' },
      'pause-ms': { type: 'string' },
      brand: { type: 'string' },
      'from-brand': { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });
  for (const name of ['brand', 'from-brand']) {
    if (values[name] !== undefined && !UUID.test(values[name])) {
      throw new Error(`--${name} must be a brand id (lower-case uuid)`);
    }
  }
  if (values.kind !== undefined && !BRAND_NUMBER_KINDS.includes(values.kind)) {
    throw new Error('--kind must be action or signal');
  }
  const pause =
    values['pause-ms'] === undefined ? BRAND_NUMBERS_PAUSE_MS : Number(values['pause-ms']);
  if (!Number.isInteger(pause) || pause < 0)
    throw new Error('--pause-ms must be a whole number >= 0');
  return {
    kinds: values.kind ? [values.kind] : BRAND_NUMBER_KINDS,
    pauseMs: pause,
    brand: values.brand ?? null,
    fromBrand: values['from-brand'] ?? null,
    dryRun: values['dry-run'] ?? false,
  };
}

async function main() {
  const done = await backfillBrandNumbers({
    ...options(),
    rpc: (fn, args) => supabaseAdmin.rpc(fn, args),
  });
  console.log(
    `Done: ${done.calls} call(s), ${done.numbered} row(s) numbered in ${Math.round(done.ms / 1000)} s.`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
