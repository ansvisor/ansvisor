/**
 * AI-bot requests sent from a brand's own Cloudflare or Vercel (AT-010, spec
 * §6). Each connection has its own secret: the sender presents it, only its
 * SHA-256 is stored, and the person sees it once when it is made.
 *
 * A batch is verified request by request (user agent on the list, IP in the
 * operator's published ranges, ai-bots.js), then written in one step that
 * holds the organization's monthly cap (00183 ai_bot_ingest): rows while
 * there is room, bot × page × day counters always. No IP is kept. Crossing
 * 80% of the cap raises the internal alert once a month (§6.3 guardrails).
 */

import { createHash, randomBytes } from 'crypto';
import supabaseAdmin from '../config/supabase.js';
import { verifyBotRequest } from './ai-bots.js';
import { getBotEventCap, getBotRawCap } from './plan-guard.js';
import { logger } from './logger.js';

/** The most requests one Worker batch may carry (a Worker sends about 100). */
export const MAX_BATCH = 500;

/** Verified events are written this many at a time. */
export const WRITE_CHUNK = 500;

/** Requests older than this are dropped: a sender catching up after a week isn't the site's reading now. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const CONNECTION_KINDS = ['cloudflare_worker', 'cloudflare_logpush', 'vercel_drain'];

const SECRET_PREFIX = 'abot_';

/** A new connection secret: 32 random bytes, shown once. */
export function newConnectionSecret() {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Where a connection sends its events: the API's public address
 * (PUBLIC_SERVER_URL), never the Host a request came in on. The create call
 * comes from the web server, which may reach the API at an internal address,
 * and the endpoint is written into the customer's Worker, Logpush job or
 * drain, where it is hard to change later. https only, but for localhost
 * outside production. Null when it isn't set or can't be used.
 */
export function publicIngestEndpoint(env = process.env) {
  let url;
  try {
    url = new URL(env.PUBLIC_SERVER_URL ?? '');
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowed =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && local && env.NODE_ENV !== 'production');
  return allowed ? `${url.origin}/bots/ingest` : null;
}

/** The live connection a secret belongs to, with its brand's organization; null otherwise. */
export async function connectionForSecret(secret) {
  if (typeof secret !== 'string' || !secret.startsWith(SECRET_PREFIX) || secret.length > 200) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from('ai_bot_connections')
    .select('id, brand_id, kind, revoked_at, brands!inner(organization_id)')
    .eq('secret_hash', hashSecret(secret))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.revoked_at) return null;
  return {
    id: data.id,
    brandId: data.brand_id,
    kind: data.kind,
    organizationId: data.brands?.organization_id ?? null,
  };
}

/** One request as a sender reports it: user agent, IP, URL, status, time, country. */
function readRequest(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const userAgent = raw.userAgent ?? raw.ua;
  const url = raw.url ?? raw.path;
  if (typeof userAgent !== 'string' || typeof raw.ip !== 'string' || typeof url !== 'string') {
    return null;
  }
  const at = new Date(raw.at ?? raw.ts ?? now);
  const ms = at.getTime();
  if (Number.isNaN(ms) || ms > now + 60 * 60 * 1000 || ms < now - MAX_AGE_MS) return null;
  const status = Number(raw.status);
  return {
    userAgent: userAgent.slice(0, 512),
    ip: raw.ip,
    url: url.slice(0, 2048),
    status: Number.isInteger(status) && status >= 100 && status < 600 ? status : null,
    country: typeof raw.country === 'string' ? raw.country.slice(0, 2).toUpperCase() : null,
    at: at.toISOString(),
  };
}

/**
 * Verify and store one batch for a connection. Returns what was received,
 * verified and stored, and why the rest wasn't counted. A Worker batch is
 * kept to MAX_BATCH; a log file (`limit: Infinity`) is read whole and its
 * verified events written WRITE_CHUNK at a time.
 */
export async function ingestBotRequests(connection, requests, deps = {}) {
  const now = deps.now ?? Date.now();
  const list = Array.isArray(requests) ? requests.slice(0, deps.limit ?? MAX_BATCH) : [];
  const skipped = { invalid: 0, unknown_agent: 0, unverified_ip: 0, no_ranges: 0 };
  const events = [];
  for (const raw of list) {
    const request = readRequest(raw, now);
    if (!request) {
      skipped.invalid++;
      continue;
    }
    const verdict = await verifyBotRequest(request, deps);
    if (!verdict.bot) {
      skipped[verdict.reason]++;
      continue;
    }
    events.push({
      bot: verdict.bot.key,
      bot_type: verdict.bot.type,
      page: request.url,
      status: request.status,
      country: request.country,
      at: request.at,
    });
  }

  let stored = 0;
  if (events.length > 0) {
    const cap = await getBotEventCap(connection.organizationId);
    // A plan without the report (Starter) stores nothing, not even counters.
    if (cap === 0)
      return { received: list.length, verified: events.length, stored, skipped, locked: true };
    for (let i = 0; i < events.length; i += WRITE_CHUNK) {
      const { data, error } = await supabaseAdmin.rpc('ai_bot_ingest', {
        p_connection_id: connection.id,
        p_cap: cap,
        p_events: events.slice(i, i + WRITE_CHUNK),
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(`ai_bot_ingest: ${data.error}`);
      stored += data?.stored ?? 0;
      if (data?.crossed80) {
        logger.warn(
          {
            organizationId: connection.organizationId,
            brandId: connection.brandId,
            used: data.used,
            cap,
          },
          '[ai-bots] 80% of the monthly bot event cap reached',
        );
      }
    }
  }

  return { received: list.length, verified: events.length, stored, skipped };
}

/**
 * Claim a log file for reading (a Logpush job's or a Vercel drain's), by
 * the SHA-256 of its body per connection: a sender that times out waiting
 * sends the same file again, and its chunks already written would count
 * twice. Returns the hash, or null when the file was read already. A read
 * that fails gives its claim back (releaseLogFile) so the retry is read.
 */
export async function claimLogFile(connection, body) {
  const hash = createHash('sha256')
    .update(Buffer.isBuffer(body) ? body : Buffer.alloc(0))
    .digest('hex');
  const { data, error } = await supabaseAdmin
    .from('ai_bot_ingested_files')
    .upsert(
      { connection_id: connection.id, body_hash: hash },
      { onConflict: 'connection_id,body_hash', ignoreDuplicates: true },
    )
    .select('body_hash');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0 ? hash : null;
}

/** Give a claim back after a read that failed. */
export async function releaseLogFile(connection, hash) {
  const { error } = await supabaseAdmin
    .from('ai_bot_ingested_files')
    .delete()
    .eq('connection_id', connection.id)
    .eq('body_hash', hash);
  if (error)
    logger.warn({ err: error, connectionId: connection.id }, '[ai-bots] claim release failed');
}

/**
 * Count a log sender's records against the month's raw cap (a Vercel drain
 * or a Logpush job, §6.3). `allowed` says whether this batch may be read; a
 * plan without the report reads none.
 */
export async function countRawRecords(connection, records) {
  const cap = await getBotRawCap(connection.organizationId);
  if (cap === 0) return { allowed: false, locked: true };
  const { data, error } = await supabaseAdmin.rpc('ai_bot_count_raw', {
    p_connection_id: connection.id,
    p_count: records,
    p_cap: cap,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(`ai_bot_count_raw: ${data.error}`);
  return { allowed: data?.allowed === true, raw: data?.raw ?? null, cap };
}

/** Verified rows are kept 90 days (§6.2); the bot × page × day counters 400. */
export const EVENT_RETENTION_DAYS = 90;
export const DAILY_RETENTION_DAYS = 400;
/** Log file hashes kept for spotting a sender's retry (claimLogFile). */
export const FILE_HASH_RETENTION_DAYS = 7;

/** The daily prune of rows past their retention (the daily run). */
export async function pruneBotEvents(now = Date.now()) {
  const before = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from('ai_bot_events')
    .delete()
    .lt('occurred_at', before(EVENT_RETENTION_DAYS));
  if (error) logger.warn({ err: error }, '[ai-bots] event prune failed');
  const { error: dailyError } = await supabaseAdmin
    .from('ai_bot_daily')
    .delete()
    .lt('day', before(DAILY_RETENTION_DAYS).slice(0, 10));
  if (dailyError) logger.warn({ err: dailyError }, '[ai-bots] daily prune failed');
  // A sender retries within minutes; a week of file hashes is plenty.
  const { error: filesError } = await supabaseAdmin
    .from('ai_bot_ingested_files')
    .delete()
    .lt('received_at', before(FILE_HASH_RETENTION_DAYS));
  if (filesError) logger.warn({ err: filesError }, '[ai-bots] file hash prune failed');
}
