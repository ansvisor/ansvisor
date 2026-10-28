import supabaseAdmin from '../../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { connectorFor, isSignIn, isStore } from '../../connectors/index.js';
import { ConnectorHttpError, requestJson } from '../../connectors/http.js';
import { FeedFormatError, parseFeed } from '../feeds/index.js';
import { isComposioConfigured } from '../composio.js';
import { PageFetchError } from '../safe-fetch.js';
import { logger } from '../logger.js';
import { PlanLimitError, getCatalogProductCap } from '../plan-guard.js';
import { queueShoppingCheck } from '../shopping-check.js';
import { CredentialsKeyError, readCredentials } from './credentials.js';
import { saveItemIssues } from './issues.js';
import { signInRequest as workspaceSignIn, workspaceEntity } from './sign-in.js';
import { syncCatalog } from './sync.js';

/**
 * A brand's catalog sources (#1263, 00279, 00282) synced into its catalog: a
 * feed URL or a store, read through its connector, daily and on demand; or
 * an uploaded CSV. Each source keeps its own products under `sourceKey(id)`,
 * and its last sync's outcome on its row (`last_*`), which the Settings card
 * shows. A store is read with its saved sign-in (credentials.js); a
 * platform like Google Merchant Center with the workspace's own sign-in
 * (sign-in.js), and the issues it reports per item are kept (issues.js).
 * On the managed cloud, the plan caps the workspace's live products
 * (ECOM-019): a source keeps what's left of it, and records how many it
 * couldn't.
 */

/** Feeds and stores read again after this long, by the daily run. */
export const SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
/** Sources a daily run reads at most, the longest waiting first, one at a time. */
export const SWEEP_LIMIT = 50;
/** A run stops starting sources after this; the rest wait first in line for the next. */
export const SWEEP_DEADLINE_MS = 10 * 60 * 1000;
/** Skipped products' errors kept on the source, for the person to see. */
const ERRORS_KEPT = 5;
/** A store's read stops calling it after this: one slow store can't hold the daily run. */
export const STORE_READ_MS = 10 * 60 * 1000;

/** The sources being read in this process: a source isn't read twice at once. */
const reading = new Set();

/** The catalog's `source` for a catalog source: `src_` and its id without dashes. */
export function sourceKey(id) {
  return `src_${String(id).replace(/-/g, '')}`;
}

/** What a store's API said, in words a person can act on. */
const STORE_WORDS = {
  invalid_url: "The store's address isn't a valid http(s) address.",
  blocked: "The store's address isn't a public one.",
  unreachable: "The store couldn't be reached.",
  timeout: 'The store took too long to answer.',
  too_large: 'The store answered with more than can be read at once.',
  rate_limited: 'The store asked to wait. The next daily run tries again.',
  bad_response: "The store's answer couldn't be read.",
};

/** Why a sync failed, in words a person can act on. No page, feed or store text. */
export function failureOf(err, connector = null) {
  if (err instanceof FeedFormatError) return { status: 'format_error', error: err.message };
  if (err instanceof PlanLimitError) return { status: 'failed', error: err.message };
  if (err instanceof ConnectorHttpError && isSignIn(connector)) {
    // The workspace's sign-in, not the source's: it's reconnected in Settings › Integrations.
    if (err.code === 'auth') {
      return {
        status: 'auth_failed',
        error: `The Google sign-in can't open this ${connector.label} account anymore. Reconnect it in Settings › Integrations.`,
      };
    }
    if (err.code === 'not_set_up') {
      // This server's own setup, or Google's for this account: reconnecting wouldn't help.
      return {
        status: 'failed',
        error: `${connector.label} isn't set up correctly on this server, or the Google account connected in Settings › Integrations can't open this account. The next daily run tries again.`,
      };
    }
    if (err.code === 'rate_limited') {
      return {
        status: 'failed',
        error: `${connector.label} asked to wait. The next daily run tries again.`,
      };
    }
    return {
      status: 'failed',
      error: `${connector.label} couldn't be read just now. The next daily run tries again.`,
    };
  }
  if (err instanceof ConnectorHttpError) {
    if (err.code === 'auth') {
      return {
        status: 'auth_failed',
        error: 'The store refused the saved sign-in. Update it in Settings › Integrations.',
      };
    }
    return {
      status: 'failed',
      error:
        STORE_WORDS[err.code] ??
        `The store answered ${err.status ?? 'an error'}. The next daily run tries again.`,
    };
  }
  if (err instanceof CredentialsKeyError) {
    return { status: 'failed', error: "Store connections aren't set up on this server." };
  }
  if (err instanceof PageFetchError) {
    const words = {
      invalid_url: "The feed's address isn't a valid http(s) address.",
      blocked: "The feed's address isn't a public one.",
      unreachable: "The feed's address couldn't be reached.",
      timeout: 'The feed took too long to answer.',
      too_large: 'The feed is larger than 50 MB.',
      not_html: "The address doesn't serve a feed (XML or CSV).",
      http_error: `The feed's address answered ${err.status ?? 'an error'}.`,
      too_many_redirects: "The feed's address redirects too many times.",
    };
    return { status: 'failed', error: words[err.code] ?? "The feed couldn't be read." };
  }
  return { status: 'failed', error: "The source couldn't be synced. Try again later." };
}

/** A sign-in the saved credentials no longer open. */
const NO_SIGN_IN = {
  status: 'auth_failed',
  error: "The store's saved sign-in can't be read. Update it in Settings › Integrations.",
};

/** A message with a store's credential values taken out, for a log. */
export function redact(message, credentials) {
  let text = String(message ?? '');
  for (const value of Object.values(credentials ?? {})) {
    if (typeof value === 'string' && value.length >= 4) text = text.split(value).join('[redacted]');
  }
  return text;
}

/**
 * The live products a source may keep (ECOM-019): its workspace's cap less
 * the live products of the workspace's other sources, on any of its brands.
 * `room` is Infinity (and `cap` -1) on a self-hosted server, or for a plan
 * without a cap.
 */
export async function productRoom(
  source,
  { db = supabaseAdmin, capOf = getCatalogProductCap } = {},
) {
  const none = { room: Infinity, cap: -1 };
  if (!isCloud()) return none;
  const { data: brand, error } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', source.brand_id)
    .maybeSingle();
  if (error) throw new Error(`brands read: ${error.message}`);
  const cap = await capOf(brand?.organization_id ?? null);
  if (cap < 0) return none;
  const { data: brands, error: brandsError } = await db
    .from('brands')
    .select('id')
    .eq('organization_id', brand.organization_id);
  if (brandsError) throw new Error(`brands read: ${brandsError.message}`);
  const { count, error: countError } = await db
    .from('catalog_products')
    .select('id', { count: 'exact', head: true })
    .in(
      'brand_id',
      (brands ?? []).map((b) => b.id),
    )
    .neq('source', sourceKey(source.id))
    .is('removed_at', null);
  if (countError) throw new Error(`catalog_products count: ${countError.message}`);
  return { room: Math.max(0, cap - (count ?? 0)), cap };
}

async function record(db, id, at, outcome) {
  const { error } = await db
    .from('catalog_sources')
    .update({
      last_synced_at: at,
      last_status: outcome.status,
      last_error: outcome.error ?? null,
      last_counts: outcome.counts ?? null,
    })
    .eq('id', id);
  if (error) throw new Error(`catalog_sources write: ${error.message}`);
}

/**
 * Syncs one source and records how it went. A feed or a store is read
 * through its connector, a store with its saved sign-in; an upload's text is
 * passed in. Never throws for the source's own failure: it's recorded and
 * returned.
 *
 * A source being read already isn't read again at once: the answer says so,
 * and nothing is recorded. A store's calls stop after `readMs` (STORE_READ_MS).
 *
 * After a sync that read the catalog, the brand's pages' shopping links are
 * checked against it (shopping-check.js), behind the answer.
 *
 * @param {{ id: string, brand_id: string, kind: string, format: string, url?: string|null, account?: string|null }} source
 * @param {{ text?: string, db?: object, now?: Date, fetch?: Function, request?: Function, signInRequest?: Function, connectors?: object, readMs?: number, capOf?: Function, afterSync?: Function }} [options]
 *   `fetch` (a feed's), `request` (a store's HTTP client), `signInRequest`
 *   (the workspace sign-in's, sign-in.js), `connectors`, `readMs`, `capOf`
 *   (the plan's product cap, by organization) and `afterSync` (the shopping
 *   check's queue) are the tests' stand-ins
 */
export async function syncSource(source, { afterSync = queueShoppingCheck, ...options } = {}) {
  if (reading.has(source.id)) {
    return {
      status: 'failed',
      error: 'This source is being read right now. Try again in a minute.',
    };
  }
  reading.add(source.id);
  let outcome;
  try {
    outcome = await syncOnce(source, options);
  } finally {
    reading.delete(source.id);
  }
  if (outcome.status === 'ok') afterSync(source.brand_id, options.db ? { db: options.db } : {});
  return outcome;
}

async function syncOnce(
  source,
  {
    text,
    db = supabaseAdmin,
    now = new Date(),
    fetch,
    request = requestJson,
    signInRequest = workspaceSignIn,
    connectors,
    readMs = STORE_READ_MS,
    capOf,
  },
) {
  const at = now.toISOString();
  let outcome;
  let credentials = null;
  let connector = null;
  try {
    let parsed;
    if (text !== undefined) {
      parsed = parseFeed(text, source.format);
    } else {
      connector = connectorFor(source.kind, connectors);
      if (!connector) {
        outcome = { status: 'failed', error: "This server can't read this kind of source." };
      } else if (isSignIn(connector) && !isComposioConfigured(connector.signIn)) {
        outcome = { status: 'failed', error: `${connector.label} isn't set up on this server.` };
      } else if (isSignIn(connector)) {
        const signedIn = signInRequest(
          connector.signIn,
          await workspaceEntity(source.brand_id, { db }),
          { hosts: connector.hosts },
        );
        // Every call the read makes stops at its deadline.
        const deadline = AbortSignal.timeout(readMs);
        parsed = await connector.readCatalog(source, {
          request: (address, opts = {}) => signedIn(address, { ...opts, signal: deadline }),
        });
      } else if (isStore(connector)) {
        credentials = await readCredentials(source.id, { db });
        // Every call the read makes stops at its deadline.
        const deadline = AbortSignal.timeout(readMs);
        const bounded = (address, opts = {}) =>
          request(address, {
            ...opts,
            signal: opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline,
          });
        if (!credentials) outcome = NO_SIGN_IN;
        else parsed = await connector.readCatalog(source, { request: bounded, credentials });
      } else {
        parsed = await connector.readCatalog(source, { fetch, request });
      }
    }
    if (!outcome) {
      const { room, cap } = await productRoom(source, { db, capOf });
      const counts = await syncCatalog(source.brand_id, sourceKey(source.id), parsed.items, {
        db,
        now,
        room,
      });
      outcome = {
        status: 'ok',
        counts: {
          format: parsed.format,
          items: parsed.items.length,
          skipped: parsed.errors.length,
          errors: parsed.errors.slice(0, ERRORS_KEPT).map((e) => e.message),
          products: counts.products,
          variants: counts.variants,
          // Products past the plan's cap, not kept (ECOM-019), and the cap.
          ...(counts.overLimit ? { overLimit: counts.overLimit, limit: cap } : {}),
        },
      };
      // An item listed again (another language or feed label), kept once: not skipped.
      if (Number.isInteger(parsed.repeated)) outcome.counts.repeated = parsed.repeated;
      if (Array.isArray(parsed.issues)) {
        outcome.counts.issues = await saveItemIssues(source, parsed.issues, { db, now });
      }
    }
  } catch (err) {
    outcome = failureOf(err, connector);
    const told = err instanceof PageFetchError || err instanceof ConnectorHttpError;
    if (outcome.status === 'failed' && !told) {
      logger.error(
        {
          err: { name: err?.name, message: redact(err?.message, credentials) },
          sourceId: source.id,
        },
        '[catalog] sync failed',
      );
    }
  }
  await record(db, source.id, at, outcome);
  return outcome;
}

/** What a source of a workspace without an active subscription records, instead of a read. */
export const NOT_READ_INACTIVE = {
  status: 'failed',
  error: "Not read: this workspace's subscription isn't active.",
};

/**
 * The daily run: feeds and stores not read for SYNC_EVERY_MS, the longest
 * waiting first, SWEEP_LIMIT a run, one at a time, until SWEEP_DEADLINE_MS.
 * On the managed cloud, only workspaces with an active subscription are
 * read. A source of any other workspace records that it wasn't read, which
 * also moves it to the back of the line: left untouched, those sources would
 * stay first in line every day and could fill a run's every slot.
 */
export async function sweepCatalogSources({
  db = supabaseAdmin,
  now = new Date(),
  fetch,
  request,
  connectors,
} = {}) {
  const started = Date.now();
  const due = new Date(now.getTime() - SYNC_EVERY_MS).toISOString();
  const { data, error } = await db
    .from('catalog_sources')
    .select(
      'id, brand_id, kind, format, url, account, last_synced_at, brands!inner(organizations!inner(subscription_status))',
    )
    .neq('kind', 'upload')
    .or(`last_synced_at.is.null,last_synced_at.lt.${due}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(`catalog_sources read: ${error.message}`);
  let synced = 0;
  let inactive = 0;
  for (const source of data ?? []) {
    if (Date.now() - started > SWEEP_DEADLINE_MS) break;
    try {
      if (!isSubscriptionActive(source.brands?.organizations?.subscription_status)) {
        await record(db, source.id, now.toISOString(), NOT_READ_INACTIVE);
        inactive++;
        continue;
      }
      await syncSource(source, { db, now, fetch, request, connectors });
      synced++;
    } catch (err) {
      logger.error(
        { err: { name: err?.name, message: err?.message }, sourceId: source.id },
        '[catalog] sweep source failed',
      );
    }
  }
  return { due: (data ?? []).length, synced, inactive };
}
