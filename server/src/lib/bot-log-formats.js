/**
 * What each AI-bot sender posts to /bots/ingest (AT-010, spec §6.1), read
 * into one request shape — { userAgent, ip, url, status, at, country } — for
 * bot-ingest.js to verify:
 *
 *   * Cloudflare Worker (option A): JSON { requests: [...] } already in that
 *     shape (bot-worker-script.js).
 *   * Cloudflare Logpush (option B): newline-delimited JSON of the
 *     http_requests dataset, gzipped — ClientRequestUserAgent, ClientIP,
 *     ClientRequestHost, ClientRequestURI, EdgeResponseStatus,
 *     EdgeStartTimestamp (unix ns, unix s or RFC 3339, as the job is set)
 *     and ClientCountry. Creating the job uploads a test file,
 *     {"content":"tests"}, which reads as no requests.
 *   * Vercel drain (option C): a JSON array or NDJSON of log entries; only
 *     those with a `proxy` object describe a request (clientIp, userAgent[],
 *     host, path, statusCode, timestamp in ms). Build and function output
 *     lines are skipped.
 *
 * Log senders report every line they hold; `records` is that count, for the
 * raw-record cap.
 */

import { gunzipSync } from 'zlib';

/** A gzipped body opens to at most this much. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * The body as text. A body sent with Content-Encoding: gzip arrives already
 * inflated by the body parser; a gzipped file sent as is (Logpush's) is told
 * by its magic bytes and inflated here.
 */
export function bodyText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  const gzipped = buffer[0] === 0x1f && buffer[1] === 0x8b;
  return (gzipped ? gunzipSync(buffer, { maxOutputLength: MAX_INFLATED_BYTES }) : buffer).toString(
    'utf8',
  );
}

/** JSON lines, or one JSON array; malformed lines are left out. */
function readLines(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const list = JSON.parse(trimmed);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  return trimmed.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

/** Logpush's EdgeStartTimestamp in any of its formats, as an ISO time. */
function logpushTime(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  // ns, ms or s since the epoch, told apart by size.
  const ms = n > 1e15 ? n / 1e6 : n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

export function readWorkerBody(text) {
  try {
    const body = JSON.parse(text || '{}');
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    return { records: requests.length, requests };
  } catch {
    return { records: 0, requests: [] };
  }
}

export function readLogpushBody(text) {
  const lines = readLines(text);
  const requests = lines
    .filter((l) => l && typeof l === 'object' && 'ClientRequestUserAgent' in l)
    .map((l) => ({
      userAgent: l.ClientRequestUserAgent,
      ip: l.ClientIP,
      url: l.ClientRequestHost
        ? `https://${l.ClientRequestHost}${l.ClientRequestURI ?? '/'}`
        : l.ClientRequestURI,
      status: l.EdgeResponseStatus,
      at: logpushTime(l.EdgeStartTimestamp),
      country: l.ClientCountry,
    }));
  return { records: lines.length, requests };
}

export function readVercelBody(text) {
  const lines = readLines(text);
  const requests = lines
    .filter((l) => l?.proxy && typeof l.proxy === 'object')
    .map(({ proxy, timestamp }) => ({
      userAgent: Array.isArray(proxy.userAgent) ? proxy.userAgent[0] : proxy.userAgent,
      ip: proxy.clientIp,
      url: proxy.host ? `https://${proxy.host}${proxy.path ?? '/'}` : proxy.path,
      status: proxy.statusCode,
      at: new Date(proxy.timestamp ?? timestamp ?? Date.now()).toISOString(),
      country: null,
    }));
  return { records: lines.length, requests };
}

const READERS = {
  cloudflare_worker: readWorkerBody,
  cloudflare_logpush: readLogpushBody,
  vercel_drain: readVercelBody,
};

/** A connection's body as requests, and how many records it held. */
export function readSenderBody(kind, buffer) {
  const read = READERS[kind];
  if (!read) return { records: 0, requests: [] };
  return read(bodyText(buffer));
}
