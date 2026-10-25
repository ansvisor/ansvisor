import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { connectorFor, isStore } from '../../connectors/index.js';
import { ConnectorHttpError, requestJson } from '../../connectors/http.js';
import { FeedFormatError, parseFeed } from '../feeds/index.js';
import { PageFetchError } from '../safe-fetch.js';
import { logger } from '../logger.js';
import { CredentialsKeyError, readCredentials } from './credentials.js';
import { syncCatalog } from './sync.js';

/**
 * A brand's catalog sources (#1263, 00279, 00282) synced into its catalog: a
 * feed URL or a store, read through its connector, daily and on demand; or
 * an uploaded CSV. Each source keeps its own products under `sourceKey(id)`,
 * and its last sync's outcome on its row (`last_*`), which the Settings card
 * shows. A store is read with its saved sign-in (credentials.js).
 */

/** Feeds and stores read again after this long, by the daily run. */
export const SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
/** Sources a daily run reads at most, the longest waiting first, one at a time. */
export const SWEEP_LIMIT = 50;
/** A run stops starting sources after this; the rest wait first in line for the next. */
export const SWEEP_DEADLINE_MS = 10 * 60 * 1000;
/** Skipped products' errors kept on the source, for the person to see. */
const ERRORS_KEPT = 5;

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
export function failureOf(err) {
  if (err instanceof FeedFormatError) return { status: 'format_error', error: err.message };
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
 * @param {{ id: string, brand_id: string, kind: string, format: string, url?: string|null, account?: string|null }} source
 * @param {{ text?: string, db?: object, now?: Date, fetch?: Function, request?: Function, connectors?: object }} [options]
 *   `fetch` (a feed's), `request` (a store's HTTP client) and `connectors`
 *   are the tests' stand-ins
 */
export async function syncSource(
  source,
  { text, db = supabaseAdmin, now = new Date(), fetch, request = requestJson, connectors } = {},
) {
  const at = now.toISOString();
  let outcome;
  let credentials = null;
  try {
    let parsed;
    if (text !== undefined) {
      parsed = parseFeed(text, source.format);
    } else {
      const connector = connectorFor(source.kind, connectors);
      if (!connector) {
        outcome = { status: 'failed', error: "This server can't read this kind of source." };
      } else if (isStore(connector)) {
        credentials = await readCredentials(source.id, { db });
        if (!credentials) outcome = NO_SIGN_IN;
        else parsed = await connector.readCatalog(source, { request, credentials });
      } else {
        parsed = await connector.readCatalog(source, { fetch, request });
      }
    }
    if (!outcome) {
      const counts = await syncCatalog(source.brand_id, sourceKey(source.id), parsed.items, {
        db,
        now,
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
        },
      };
    }
  } catch (err) {
    outcome = failureOf(err);
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

/**
 * The daily run: feeds and stores not read for SYNC_EVERY_MS, the longest
 * waiting first, SWEEP_LIMIT a run, one at a time, until SWEEP_DEADLINE_MS.
 * On the managed cloud, only workspaces with an active subscription.
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
  for (const source of data ?? []) {
    if (Date.now() - started > SWEEP_DEADLINE_MS) break;
    if (!isSubscriptionActive(source.brands?.organizations?.subscription_status)) continue;
    try {
      await syncSource(source, { db, now, fetch, request, connectors });
      synced++;
    } catch (err) {
      logger.error(
        { err: { name: err?.name, message: err?.message }, sourceId: source.id },
        '[catalog] sweep source failed',
      );
    }
  }
  return { due: (data ?? []).length, synced };
}
