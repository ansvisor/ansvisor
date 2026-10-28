/**
 * The demo brand (00380): Brewline Coffee, a fictional brand with sample
 * data in the real tables, one per organization. People without a plan (or
 * who just want a look) explore the live product on it: every page reads it
 * through its own queries. Nothing that costs ever runs for it (the sweeps,
 * jobs and limits skip `is_demo`).
 *
 * It keeps itself current: a brand built with an older DEMO_VERSION, or
 * whose month of data has grown old, is rebuilt on the next visit, in place
 * (same brand id, same row ids), so links to it keep working. A product
 * change that the demo should show is a new module, or a change to one, and
 * a DEMO_VERSION bump; the coverage test (coverage.test.js) fails until every
 * brand-scoped table is either built by a module or listed as skipped.
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { actionCenter } from './action-center.js';
import { BRAND } from './brewline.js';
import { content } from './content.js';
import { core } from './core.js';
// demo-site: AI Referral Traffic, Site Audit, the catalog and fan-out intents.
import { catalog } from './catalog.js';
import { fanoutIntents } from './fanout-intents.js';
import { site } from './site.js';
import { traffic } from './traffic.js';
import { reports } from './reports.js';
import { suggestions } from './suggestions.js';

/**
 * Bump to rebuild every demo brand on its next visit.
 * 2: Action Center, Content, suggestions and reports (demo-workflows).
 * 3: AI Referral Traffic, Site Audit, the catalog and fan-out intents (demo-site).
 */
export const DEMO_VERSION = 3;

/** Data older than this is rebuilt, so the demo's latest run stays recent. */
export const DEMO_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How long a build under way holds the demo brand: another server finding it
 * mid-build waits for it this long, then takes over (a build cut short by a
 * restart is never finished by anyone else).
 */
export const DEMO_BUILD_LEASE_MS = 10 * 60 * 1000;

/** How long a visit waits on another server's build before answering as it stands. */
export const DEMO_WAIT_MS = 60 * 1000;
/** How often a visit waiting on another server's build looks again. */
const WAIT_POLL_MS = 1000;

/**
 * The modules that build the demo. Each is `{ name, tables, build(ctx),
 * after? }`: `tables` are the brand-scoped tables it owns (written, or
 * rebuilt by what it calls), cleared in reverse order before a rebuild. The
 * first (core) runs alone; the others run together, each after the one it
 * names in `after` (Content after the Action Center: a draft points at the
 * action its opportunity was sent as).
 */
export const DEMO_MODULES = [
  core,
  // demo-site: AI Referral Traffic, Site Audit, Product Visibility's catalog,
  // and the intents of the core's fan-out searches (a shared cache).
  traffic,
  site,
  catalog,
  fanoutIntents,
  // demo-workflows: suggestions, the Action Center, Content and reports.
  suggestions,
  actionCenter,
  content,
  reports,
];

const COLUMNS = 'id, demo_version, demo_built_at, demo_hidden_at';

/** Builds in progress in this process, by organization. */
const inFlight = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readDemoBrand(organizationId) {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('is_demo', true)
    .maybeSingle();
  if (error) throw new Error(`demo brand read: ${error.message}`);
  return data;
}

/**
 * Creates the organization's demo brand, holding it for its first build. A
 * second visit creating it at the same moment hits the one-per-organization
 * index (23505) and reads the first one's row instead.
 */
async function createDemoBrand(organizationId, now) {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .insert({
      organization_id: organizationId,
      name: BRAND.name,
      slug: BRAND.slug,
      is_demo: true,
      demo_version: null,
      demo_built_at: now.toISOString(),
    })
    .select(COLUMNS)
    .single();
  if (!error) return { brand: data, claimed: true };
  if (error.code !== '23505') throw new Error(`demo brand insert: ${error.message}`);
  const existing = await readDemoBrand(organizationId);
  if (!existing) throw new Error(`demo brand insert: ${error.message}`);
  return { brand: existing, claimed: false };
}

/**
 * Where a demo brand's data stands: 'fresh' (current version, recent),
 * 'building' (a build started within the lease) or 'stale'.
 */
export function demoState(brand, now = new Date()) {
  const builtAt = brand.demo_built_at ? Date.parse(brand.demo_built_at) : null;
  const age = builtAt === null ? Infinity : now.getTime() - builtAt;
  if (brand.demo_version === null || brand.demo_version === undefined) {
    return age < DEMO_BUILD_LEASE_MS ? 'building' : 'stale';
  }
  // A newer server's demo is left to it.
  if (brand.demo_version > DEMO_VERSION) return 'fresh';
  if (brand.demo_version < DEMO_VERSION) return 'stale';
  return age < DEMO_MAX_AGE_MS ? 'fresh' : 'stale';
}

/**
 * Takes the build: only if the row is still as read, so of two servers
 * finding it stale at once, one rebuilds and the other waits.
 */
async function claimBuild(brand, now) {
  let query = supabaseAdmin
    .from('brands')
    .update({ demo_version: null, demo_built_at: now.toISOString() })
    .eq('id', brand.id);
  query =
    brand.demo_version === null || brand.demo_version === undefined
      ? query.is('demo_version', null)
      : query.eq('demo_version', brand.demo_version);
  query = brand.demo_built_at
    ? query.eq('demo_built_at', brand.demo_built_at)
    : query.is('demo_built_at', null);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`demo build claim: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Clears every module's tables for the brand, the last module's first. */
export async function clearDemoData(brandId, modules = DEMO_MODULES) {
  for (const module of [...modules].reverse()) {
    for (const table of [...module.tables].reverse()) {
      const { error } = await supabaseAdmin.from(table).delete().eq('brand_id', brandId);
      if (error) throw new Error(`demo ${table} clear: ${error.message}`);
    }
  }
}

/**
 * After a failed build: lets the next visit rebuild at once instead of
 * waiting out the lease. Best effort; the lease covers a failure here.
 */
async function releaseBuild(brandId) {
  const { error } = await supabaseAdmin
    .from('brands')
    .update({ demo_built_at: null })
    .eq('id', brandId)
    .is('demo_version', null);
  if (error) logger.warn({ brandId, err: error }, '[demo] failed build not released');
}

async function build(brandId, now, modules) {
  const started = Date.now();
  const built = {};
  try {
    await clearDemoData(brandId, modules);
    // The first module (core) lays down what every other one points at; the
    // rest write their own tables side by side, each after the module it
    // names in `after`, if any.
    const [first, ...rest] = modules;
    built[first.name] = await first.build({ brandId, now });
    const running = new Map();
    const run = (module) => {
      if (!running.has(module.name)) {
        const before = module.after && rest.find((m) => m.name === module.after);
        running.set(
          module.name,
          (async () => {
            if (before) await run(before);
            built[module.name] = await module.build({ brandId, now });
          })(),
        );
      }
      return running.get(module.name);
    };
    const results = await Promise.allSettled(rest.map(run));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  } catch (err) {
    await releaseBuild(brandId);
    throw err;
  }
  const { error } = await supabaseAdmin
    .from('brands')
    .update({ demo_version: DEMO_VERSION, demo_built_at: now.toISOString() })
    .eq('id', brandId);
  if (error) throw new Error(`demo build stamp: ${error.message}`);
  logger.info({ brandId, built, ms: Date.now() - started }, '[demo] demo brand built');
}

/** Waits for another server's build of the brand, up to DEMO_WAIT_MS. */
async function waitForBuild(organizationId) {
  const since = Date.now();
  for (;;) {
    await sleep(WAIT_POLL_MS);
    const brand = await readDemoBrand(organizationId);
    if (!brand) return null;
    if (demoState(brand, new Date()) !== 'building' || Date.now() - since >= DEMO_WAIT_MS) {
      return brand;
    }
  }
}

async function ensure(organizationId, now, modules) {
  let brand = await readDemoBrand(organizationId);
  let claimed = false;
  if (!brand) ({ brand, claimed } = await createDemoBrand(organizationId, now));

  if (!claimed) {
    let state = demoState(brand, now);
    if (state === 'building') {
      brand = (await waitForBuild(organizationId)) ?? brand;
      state = demoState(brand, new Date());
    }
    if (state !== 'stale') {
      return { brandId: brand.id, version: brand.demo_version ?? null, rebuilt: false };
    }
    if (!(await claimBuild(brand, now))) {
      // Another server took it a moment ago.
      const after = (await waitForBuild(organizationId)) ?? brand;
      return { brandId: after.id, version: after.demo_version ?? null, rebuilt: false };
    }
  }

  await build(brand.id, now, modules);
  return { brandId: brand.id, version: DEMO_VERSION, rebuilt: true };
}

/**
 * The organization's demo brand, created or rebuilt when it has to be.
 * Whether it is hidden (demo_hidden_at) is left as it is. Two calls for one
 * organization in this process share one build.
 *
 * @param {{ organizationId: string, now?: Date, modules?: object[] }} args
 * @returns {Promise<{ brandId: string, version: number|null, rebuilt: boolean }>}
 */
export function ensureDemoBrand({ organizationId, now = new Date(), modules = DEMO_MODULES }) {
  if (!inFlight.has(organizationId)) {
    const run = ensure(organizationId, now, modules).finally(() => inFlight.delete(organizationId));
    inFlight.set(organizationId, run);
  }
  return inFlight.get(organizationId);
}

/**
 * Hides or shows the organization's demo brand: the organization's choice,
 * not one person's. Never deletes it.
 *
 * @param {{ organizationId: string, hidden: boolean, now?: Date }} args
 * @returns {Promise<{ brandId: string, hidden: boolean } | null>} null without a demo brand
 */
export async function setDemoHidden({ organizationId, hidden, now = new Date() }) {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .update({ demo_hidden_at: hidden ? now.toISOString() : null })
    .eq('organization_id', organizationId)
    .eq('is_demo', true)
    .select('id');
  if (error) throw new Error(`demo brand hide: ${error.message}`);
  const brand = data?.[0];
  return brand ? { brandId: brand.id, hidden } : null;
}
