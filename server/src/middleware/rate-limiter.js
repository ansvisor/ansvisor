import rateLimit from 'express-rate-limit';
import { verifiedUserId } from './verified-tokens.js';

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
