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
 *   * Fastly HTTPS log stream (fastly_log_stream, #2164): JSON lines or one
 *     JSON array with the fields in FASTLY_LOG_FORMAT: timestamp, client_ip,
 *     request_user_agent, url, response_status and country.
 *   * Generic webhook (log_webhook, #2170): JSON lines, or one JSON array,
 *     with the documented fields: user_agent, ip, url (a full address, or a
 *     path) or host and path, status, time (RFC 3339, or seconds or
 *     milliseconds since the epoch) and country (two letters, optional).
 *   * An uploaded access log (log_upload, #2170): the combined log format
 *     (Apache's and nginx's default), the common log format, or the same
 *     JSON lines, line by line. A common-format line names no user agent,
 *     so it is counted but never a bot.
 *
 * Log senders report every line they hold; `records` is that count, for the
 * raw-record cap.
 *
 * A file is read without holding up the API's other requests: it's inflated
 * asynchronously, to at most MAX_INFLATED_BYTES, holds at most MAX_LOG_LINES
 * (LogTooLargeError otherwise), and its lines are parsed a slice at a time.
 * A line whose time can't be read is dropped, not the file.
 */

import { setImmediate as nextTurn } from 'timers/promises';
import { promisify } from 'util';
import { gunzip } from 'zlib';

const gunzipAsync = promisify(gunzip);

/**
 * A gzipped body opens to at most this much. A Logpush job set up as
 * bot-sender-setup.js says sends at most 10,000 lines, about 3 MB.
 */
export const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

/** Lines one body may hold: twice what such a Logpush file holds. */
export const MAX_LOG_LINES = 20_000;

/** Lines parsed before the API's other requests get a turn. */
const PARSE_SLICE = 1000;

/** A body past MAX_INFLATED_BYTES or MAX_LOG_LINES; the route answers 413. */
export class LogTooLargeError extends Error {}

/**
 * An uploaded file with no line in a format it reads (#2170): not an access
 * log or JSON lines, so it isn't counted against the raw cap; the route
 * answers 400.
 */
export class LogUnreadableError extends Error {}

/**
 * The body as text. A body sent with Content-Encoding: gzip arrives already
 * inflated by the body parser; a gzipped file sent as is (Logpush's) is told
 * by its magic bytes and inflated here.
 */
export async function bodyText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  const gzipped = buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!gzipped) return buffer.toString('utf8');
  try {
    const inflated = await gunzipAsync(buffer, { maxOutputLength: MAX_INFLATED_BYTES });
    return inflated.toString('utf8');
  } catch (err) {
    if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new LogTooLargeError(`The file opens to more than ${MAX_INFLATED_BYTES} bytes`);
    }
    throw err;
  }
}

const tooManyLines = (count) =>
  new LogTooLargeError(`The file holds ${count} lines; at most ${MAX_LOG_LINES} are read`);

/** JSON lines, or one JSON array; malformed lines are left out. */
async function readLines(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    let list;
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    if (list.length > MAX_LOG_LINES) throw tooManyLines(list.length);
    return list;
  }
  const lines = trimmed.split('\n');
  if (lines.length > MAX_LOG_LINES) throw tooManyLines(lines.length);
  const read = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % PARSE_SLICE === 0) await nextTurn();
    const line = lines[i].trim();
    if (!line) continue;
    try {
      read.push(JSON.parse(line));
    } catch {
      // A malformed line is left out.
    }
  }
  return read;
}

/** An ISO time, or undefined for a value that isn't one. */
function isoTime(ms) {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Logpush's EdgeStartTimestamp in any of its formats, as an ISO time. */
function logpushTime(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return isoTime(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  // ns, ms or s since the epoch, told apart by size.
  return isoTime(n > 1e15 ? n / 1e6 : n > 1e12 ? n : n * 1000);
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

export async function readLogpushBody(text) {
  const lines = await readLines(text);
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
    }))
    .filter((r) => r.at !== undefined);
  return { records: lines.length, requests };
}

export async function readVercelBody(text) {
  const lines = await readLines(text);
  const requests = lines
    .filter((l) => l?.proxy && typeof l.proxy === 'object')
    .map(({ proxy, timestamp }) => ({
      userAgent: Array.isArray(proxy.userAgent) ? proxy.userAgent[0] : proxy.userAgent,
      ip: proxy.clientIp,
      url: proxy.host ? `https://${proxy.host}${proxy.path ?? '/'}` : proxy.path,
      status: proxy.statusCode,
      at: isoTime(proxy.timestamp ?? timestamp ?? Date.now()),
      country: null,
    }))
    .filter((r) => r.at !== undefined);
  return { records: lines.length, requests };
}

/** A JSON line with the documented fields (above), as a request. */
function documentedRequest(line) {
  const host = typeof line.host === 'string' && line.host ? line.host : null;
  const path = typeof line.path === 'string' ? line.path : null;
  return {
    userAgent: line.user_agent ?? line.userAgent,
    ip: line.ip,
    url: typeof line.url === 'string' ? line.url : host ? `https://${host}${path ?? '/'}` : path,
    status: line.status,
    at: logpushTime(line.time ?? line.timestamp),
    country: line.country,
  };
}

export async function readJsonLinesBody(text) {
  const lines = await readLines(text);
  const requests = lines
    .filter((l) => l && typeof l === 'object')
    .map(documentedRequest)
    .filter((r) => r.at !== undefined);
  return { records: lines.length, requests };
}

/** Fastly HTTPS log stream: its custom JSON fields, as a request. */
export async function readFastlyBody(text) {
  const lines = await readLines(text);
  const requests = lines
    .filter((l) => l && typeof l === 'object' && 'request_user_agent' in l)
    .map((l) => ({
      userAgent: l.request_user_agent,
      ip: l.client_ip,
      url: typeof l.url === 'string' && /^https?:\/\//i.test(l.url)
        ? l.url
        : typeof l.host === 'string' && l.host
          ? `https://${l.host}${l.url ?? '/'}`
          : l.url,
      status: l.response_status,
      at: logpushTime(l.timestamp),
      country: l.country,
    }))
    .filter((r) => r.at !== undefined);
  return { records: lines.length, requests };
}

const MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/** An access log's time, "10/Oct/2026:13:55:36 +0000", as an ISO time. */
function accessLogTime(value) {
  const m = /^(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(
    value,
  );
  if (!m || !MONTHS[m[2]]) return undefined;
  return isoTime(`${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}${m[5]}:${m[6]}`);
}

/**
 * A combined or common log format line: ip - user [time] "METHOD path PROTO"
 * status bytes, and in the combined format "referer" "user agent".
 */
const ACCESS_LINE =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:[A-Z]+ )?(\S+)(?: [^"]*)?" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;

function accessLogRequest(line) {
  const m = ACCESS_LINE.exec(line);
  if (!m) return null;
  return {
    userAgent: m[5],
    ip: m[1],
    url: m[3],
    status: m[4],
    at: accessLogTime(m[2]),
    country: null,
  };
}

/**
 * An uploaded access log (above), a line at a time: JSON lines and log lines
 * may mix. A file with no line in either format (another kind of file) is
 * LogUnreadableError, so it isn't counted.
 */
export async function readUploadBody(text) {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length > MAX_LOG_LINES) throw tooManyLines(lines.length);
  const requests = [];
  let readable = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % PARSE_SLICE === 0) await nextTurn();
    const line = lines[i].trim();
    let request = null;
    if (line.startsWith('{')) {
      try {
        request = documentedRequest(JSON.parse(line));
      } catch {
        // A malformed line is left out.
      }
    } else {
      request = accessLogRequest(line);
    }
    if (request) readable++;
    // A common-format line names no user agent: counted, never a bot.
    if (request && request.at !== undefined && typeof request.userAgent === 'string') {
      requests.push(request);
    }
  }
  if (lines.length > 0 && readable === 0) {
    throw new LogUnreadableError('No line is an access log line or a JSON line');
  }
  return { records: lines.length, requests };
}

const READERS = {
  cloudflare_worker: readWorkerBody,
  cloudflare_logpush: readLogpushBody,
  vercel_drain: readVercelBody,
  log_webhook: readJsonLinesBody,
  fastly_log_stream: readFastlyBody,
  log_upload: readUploadBody,
};

/** A connection's body as requests, and how many records it held. */
export async function readSenderBody(kind, buffer) {
  const read = READERS[kind];
  if (!read) return { records: 0, requests: [] };
  return read(await bodyText(buffer));
}
