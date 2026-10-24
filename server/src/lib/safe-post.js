/**
 * Posting JSON to an address a workspace configured (Send to CMS, #1331).
 * On Ansvisor Cloud it never reaches anything private, as fetchPage reads a
 * page:
 *   * http(s) only, with no credentials in it; any port, since a workspace's
 *     own automation (n8n, a CMS) often listens on one of its own;
 *   * every address its host resolves to must be public, checked in the
 *     connection's own DNS lookup (no DNS rebinding);
 *   * no redirect is followed: a 3xx is an answer, as any other non-2xx;
 *   * a time limit for the whole request, and only the start of the answer
 *     is read back.
 * Self-hosted, a private address is the workspace's own network (n8n at
 * http://n8n:5678), as its other webhooks reach it: only the scheme and
 * credentials are checked. Failures carry PageFetchError's codes:
 * invalid_url, blocked, unreachable, timeout.
 */

import http from 'node:http';
import https from 'node:https';
import { isCloud } from '../config/plans.js';
import { PageFetchError, checkPageUrl, publicOnlyLookup } from './safe-fetch.js';

export const POST_TIMEOUT_MS = 15_000;
/** How much of an answer is read back: enough to keep with the delivery. */
export const MAX_ANSWER_BYTES = 8 * 1024;

const USER_AGENT = 'Ansvisor-Webhook/1.0 (+https://ansvisor.com)';

/**
 * A webhook address, checked as a page's is but on any port; throws
 * 'invalid_url' or 'blocked'. `privateOk` (self-hosted) takes a private one.
 */
export function checkWebhookUrl(value, { privateOk = false } = {}) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new PageFetchError('invalid_url', 'Not a URL');
  }
  if (!privateOk) return checkPageUrl(value, [url.port]);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PageFetchError('invalid_url', 'Only http and https addresses can be posted to');
  }
  if (url.username || url.password) {
    throw new PageFetchError('invalid_url', 'URLs with credentials are not posted to');
  }
  return url;
}

/**
 * POSTs `body` (a string, already JSON) to the address.
 * @param {string} address
 * @param {string} body
 * @param {{ headers?: Record<string, string>, timeoutMs?: number, lookup?: Function }} [opts]
 *   `lookup` replaces the public-only lookup; tests use it to reach a local server.
 * @returns {Promise<{ status: number, answer: string }>} the HTTP status and the start of the answer
 */
export async function postJson(address, body, opts = {}) {
  const cloud = isCloud();
  const url = checkWebhookUrl(address, { privateOk: !cloud });
  const { headers = {}, timeoutMs = POST_TIMEOUT_MS } = opts;
  // The test's lookup, else the public-only one on Cloud, else the system's.
  const lookup = opts.lookup ?? (cloud ? publicOnlyLookup : undefined);
  const signal = AbortSignal.timeout(timeoutMs);
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'POST',
        agent: false,
        lookup,
        signal,
        headers: {
          'user-agent': USER_AGENT,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks = [];
        let size = 0;
        const done = () => resolve({ status, answer: Buffer.concat(chunks).toString('utf8') });
        res.on('data', (chunk) => {
          if (size >= MAX_ANSWER_BYTES) return;
          chunks.push(chunk.subarray(0, MAX_ANSWER_BYTES - size));
          size += chunk.length;
          // The rest of a long answer isn't read.
          if (size >= MAX_ANSWER_BYTES) {
            res.destroy();
            done();
          }
        });
        res.on('end', done);
        res.on('error', (err) => reject(err));
      },
    );
    req.on('error', (err) => {
      if (err instanceof PageFetchError) return reject(err);
      if (signal.aborted) {
        return reject(new PageFetchError('timeout', 'The webhook took too long to answer'));
      }
      reject(
        new PageFetchError('unreachable', 'The webhook could not be reached', { errno: err?.code }),
      );
    });
    req.end(body);
  });
}
