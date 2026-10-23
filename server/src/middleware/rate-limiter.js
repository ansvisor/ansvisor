import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { verifiedBotConnection, verifiedUserId } from './verified-tokens.js';

/**
 * Anonymous bucket key. IPv4 (including v4-mapped IPv6) keys on the exact
 * address; plain IPv6 collapses to the /64 prefix so one caller can't dodge
 * the limit by rotating through their subnet's practically unlimited
 * addresses.
 */
export function anonymousIpKey(ip) {
  if (!ip) return 'ip:unknown';
  if (!ip.includes(':') || ip.includes('.')) return 'ip:' + ip;
  const [head, tail = ''] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const zeros = Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0');
  const prefix = [...headGroups, ...zeros, ...tailGroups].slice(0, 4).join(':');
  return 'ip:' + prefix + '::/64';
}

/**
 * Key dashboard traffic by VERIFIED user, falling back to IP. The web app's
 * server actions all egress through Vercel's small shared IP pool, so a purely
 * IP-keyed limiter lumps every user's server-side traffic (volume analyses,
 * tracking-status polls, page loads…) into a handful of buckets and 429s
 * legitimate users while browser-direct calls sail through.
 *
 * The per-user bucket is granted only to tokens decodeToken has already
 * verified (see verified-tokens.js): merely ATTACHING an Authorization header
 * earns nothing, so an attacker spamming forged tokens stays pinned to their
 * IP bucket. A legit token's first-ever request counts against the IP bucket
 * too (it isn't verified yet) — one request per token per half hour, noise.
 * Rotating IPs to evade the anonymous limit remains an infra-level concern
 * (WAF/CDN), same as before this limiter existed.
 */
export function apiLimiterKey(req) {
  const userId = verifiedUserId(req.headers.authorization);
  if (userId) return 'user:' + userId;
  return anonymousIpKey(req.ip);
}

// General API rate limit, per verified user (per IP otherwise)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // A verified user's bucket only needs to absorb their own burst (several
  // tabs polling tracking status every 15s plus normal navigation).
  // Unverified traffic keeps the tighter IP limit.
  max: (req) => (verifiedUserId(req.headers.authorization) ? 1000 : 250),
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// A draft's link check (Content Editor Trust): the editor asks after its
// links change, a few times a minute at most. Each ask can read links on
// other sites, so it has its own bucket besides the API's.
export const linkCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: apiLimiterKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Stricter limit for public/unauthenticated endpoints: 30 requests per 15 minutes
export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Traffic tracking beacon: 60 requests per minute per IP
export const trafficLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: '',
  handler: (_req, res) => res.status(204).end(),
});

/**
 * AI-bot ingest key (AT-010): the connection, since a Cloudflare Worker's
 * requests leave from addresses Cloudflare shares across its customers. Only
 * a secret the route has already matched to a live connection
 * (verified-tokens.js) earns that bucket: an unknown one, or none, counts
 * against the caller's IP, so a flood of made-up secrets can't take a fresh
 * bucket, and a lookup, per request.
 */
export function botIngestKey(req) {
  const connectionId = verifiedBotConnection(req.headers.authorization);
  if (connectionId) return 'bot:' + connectionId;
  return anonymousIpKey(req.ip);
}

/**
 * Group public workflow callbacks by a hash of the supplied webhook secret,
 * not the provider's shared egress IP. Missing secrets fall back to IP; a
 * separate failed-auth limiter below keeps brute-force attempts constrained.
 */
export function webhookCallbackKey(req) {
  const header = req.get?.('X-Webhook-Secret') ?? req.headers?.['x-webhook-secret'];
  const secret = typeof header === 'string' ? header : '';
  if (!secret) return anonymousIpKey(req.ip);
  return 'webhook:' + createHash('sha256').update(secret).digest('hex');
}

// Workflow providers share egress IP pools and may fan out multiple callbacks
// per opportunity. Give each configured webhook its own generous 15-minute
// budget, independent of all other customers using the same provider IP.
export const webhookCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  keyGenerator: webhookCallbackKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// Only failed authentication attempts (401) consume this small per-IP bucket.
// Valid callbacks and unrelated 4xx/5xx responses are removed from the counter
// after the response finishes.
export const webhookCallbackAuthFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => anonymousIpKey(req.ip),
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_failed_webhook_auth_attempts' },
});

// AI-bot ingest: 600 requests a minute per connection. A Worker isolate
// sends a batch about every 10 s, and a Logpush job or drain a file at a
// time, so this leaves room for many of them while stopping a runaway sender.
export const botIngestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: botIngestKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// Auth endpoints: 10 requests per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
});
