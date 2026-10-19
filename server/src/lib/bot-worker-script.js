/**
 * The Cloudflare Worker a brand installs to send AI-bot requests (AT-010,
 * spec §6.1 option A, "lowest cost for us"). It passes every request through
 * untouched, and only for requests whose user agent names a bot on the list
 * sends {userAgent, ip, url, status, at, country} to Ansvisor in batches of
 * about 100, after the response, without slowing the page.
 *
 * The bot tokens come from ai-bots.json, so the edge filter and the server's
 * check use the same list; the server still verifies every IP.
 */

import { AI_BOTS } from './ai-bots.js';

/** Requests a Worker isolate holds before it sends them. */
export const WORKER_BATCH = 100;

export function buildWorkerScript({ endpoint, secret }) {
  const tokens = JSON.stringify(AI_BOTS.map((b) => b.userAgent.toLowerCase()));
  return `// Ansvisor AI bot report — Cloudflare Worker (AT-010).
// Passes every request through; for AI bots only, sends the request line to
// Ansvisor after the response. Route it on your site's hostname.
const ENDPOINT = ${JSON.stringify(endpoint)};
const SECRET = ${JSON.stringify(secret)};
const BOTS = ${tokens};
const BATCH = ${WORKER_BATCH};
let queue = [];

function pageUrl(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

function isAiBot(ua) {
  const s = (ua || '').toLowerCase();
  return BOTS.some((t) => s.includes(t));
}

async function flush() {
  if (queue.length === 0) return;
  const requests = queue;
  queue = [];
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET },
      body: JSON.stringify({ requests }),
    });
  } catch (err) {
    // Never let reporting affect the site.
  }
}

export default {
  async fetch(request, env, ctx) {
    // Should this script fail, the request still reaches the site.
    ctx.passThroughOnException();
    const response = await fetch(request);
    const ua = request.headers.get('user-agent');
    if (isAiBot(ua)) {
      queue.push({
        userAgent: ua,
        ip: request.headers.get('cf-connecting-ip'),
        // The page, without its query string.
        url: pageUrl(request.url),
        status: response.status,
        at: new Date().toISOString(),
        country: request.cf && request.cf.country,
      });
      if (queue.length >= BATCH) ctx.waitUntil(flush());
      else ctx.waitUntil(new Promise((r) => setTimeout(r, 10000)).then(flush));
    }
    return response;
  },
};
`;
}
