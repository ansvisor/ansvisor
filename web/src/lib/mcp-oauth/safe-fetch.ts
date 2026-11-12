import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

/**
 * Fetching a document an app names by URL (a Client ID Metadata Document,
 * MCP over OAuth #2141) without letting the URL reach anything private
 * (SSRF: the MCP authorization spec asks authorization servers to guard
 * against it). The checks of the API server's safe-fetch.js, for JSON:
 *
 *   * https only, on the standard port, with no credentials in the URL;
 *   * a host written as an IP address is refused: it connects without a
 *     DNS lookup, so the lookup's check below would never see it;
 *   * every address the host resolves to must be public, checked in the
 *     connection's own DNS lookup, so the address connected to is the one
 *     checked (no DNS rebinding between a check and the request);
 *   * no redirects followed; 5 seconds for the whole request, however slowly
 *     it trickles in; 10 KB; JSON only.
 */

export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_DOCUMENT_BYTES = 10 * 1024;

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'blocked'
  | 'unreachable'
  | 'timeout'
  | 'redirect'
  | 'http_error'
  | 'not_json'
  | 'too_large';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

// Private, local, shared, documentation and reserved ranges (RFC 6890), as
// server/src/lib/safe-fetch.js blocks them; an IPv4-mapped IPv6 address is
// checked against the IPv4 ranges by BlockList itself.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(address, prefix, 'ipv6');
}

/** Whether an IP address is one a public document may live at. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return !BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

type LookupAddress = { address: string; family: number };
type AllLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A DNS lookup, in the signature https.request's `lookup` option takes,
 * that refuses a name resolving to any address that isn't public.
 */
export function publicOnlyLookup(resolve: AllLookup = dns.lookup as unknown as AllLookup) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    resolve(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, '');
      if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
        return callback(
          new SafeFetchError('blocked', `${hostname} does not resolve to a public address`),
          '',
        );
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/** A URL Ansvisor may fetch a document from: https, the standard port, no credentials or fragment. */
export function checkFetchUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeFetchError('invalid_url', 'Not a URL');
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('invalid_url', 'Only https is fetched');
  if (url.port && url.port !== '443') throw new SafeFetchError('invalid_url', 'Only port 443');
  if (url.username || url.password || url.hash) {
    throw new SafeFetchError('invalid_url', 'No credentials or fragment');
  }
  if (isIpHost(url)) throw new SafeFetchError('blocked', 'An IP address is not fetched');
  return url;
}

/**
 * Whether a URL's host is an IP address rather than a name. The URL parser
 * has already turned 2130706433 or 0x7f.1 into 127.0.0.1; an IPv6 host
 * keeps its brackets.
 */
export function isIpHost(url: URL): boolean {
  return net.isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface GetOptions {
  /** https.request; a test passes http.request with an http URL. */
  request?: typeof https.request;
  lookup?: ReturnType<typeof publicOnlyLookup>;
  timeoutMs?: number;
}

/**
 * The request itself, through publicOnlyLookup, stopped at the size limit
 * and at one deadline for the whole request (not a socket's idle time, which
 * a server sending a byte at a time would keep resetting).
 */
export function httpsGet(
  url: URL,
  {
    request = https.request,
    lookup = publicOnlyLookup(),
    timeoutMs = FETCH_TIMEOUT_MS,
  }: GetOptions = {},
): Promise<RawResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  return new Promise((resolve, reject) => {
    const fail = (err: unknown) =>
      reject(
        err instanceof SafeFetchError
          ? err
          : signal.aborted
            ? new SafeFetchError('timeout', 'The document took too long')
            : new SafeFetchError('unreachable', `Could not reach ${url.host}`),
      );
    const req = request(
      url,
      {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'Ansvisor-OAuth/1.0' },
        lookup: lookup as unknown as typeof dns.lookup,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_DOCUMENT_BYTES) {
            fail(new SafeFetchError('too_large', 'The document is larger than 10 KB'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        // Cut off part way, by the deadline or the server: never a partial document.
        res.on('close', () => {
          if (!res.complete) fail(new Error('incomplete'));
        });
        res.on('error', fail);
      },
    );
    req.on('error', (err) => fail(err.cause instanceof SafeFetchError ? err.cause : err));
    req.end();
  });
}

/** A Cache-Control max-age, in seconds; null when it gives none (no-store gives 0). */
export function maxAgeOf(header: string | string[] | undefined): number | null {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '');
  if (/\bno-store\b|\bno-cache\b/i.test(value)) return 0;
  const match = value.match(/\bmax-age=(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** A public JSON document, and how long its server lets it be kept. */
export async function fetchPublicJson(
  value: string,
  get: (url: URL) => Promise<RawResponse> = httpsGet,
): Promise<{ body: unknown; maxAge: number | null }> {
  const url = checkFetchUrl(value);
  const res = await get(url);
  if (res.status >= 300 && res.status < 400) {
    throw new SafeFetchError('redirect', 'Redirects are not followed');
  }
  if (res.status !== 200) throw new SafeFetchError('http_error', `HTTP ${res.status}`);
  const type = String(res.headers['content-type'] ?? '');
  if (!/^\s*application\/([\w.+-]+\+)?json\b/i.test(type)) {
    throw new SafeFetchError('not_json', 'The document is not JSON');
  }
  if (res.body.length > MAX_DOCUMENT_BYTES) {
    throw new SafeFetchError('too_large', 'The document is larger than 10 KB');
  }
  try {
    return {
      body: JSON.parse(res.body.toString('utf8')),
      maxAge: maxAgeOf(res.headers['cache-control']),
    };
  } catch {
    throw new SafeFetchError('not_json', 'The document is not JSON');
  }
}
