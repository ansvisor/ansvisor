import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';

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
 * Key authenticated dashboard traffic by bearer token, not by IP. The web
 * app's server actions all egress through Vercel's small shared IP pool, so an
 * IP-keyed limiter lumps every user's server-side traffic (volume analyses,
 * tracking-status polls, page loads…) into a handful of buckets and 429s
 * legitimate users while browser-direct calls sail through. The token is
 * hashed so raw JWTs never sit in the limiter's store, and it doesn't need to
 * be verified here — a forged token just earns its own bucket. Anonymous
 * requests still fall back to the caller IP.
 */
export function apiLimiterKey(req) {
  const auth = req.headers.authorization;
  if (auth) {
    return 'token:' + createHash('sha256').update(auth).digest('hex').slice(0, 32);
  }
  return anonymousIpKey(req.ip);
}

// General API rate limit, per user token (per IP when unauthenticated)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Authenticated buckets are per user, so the ceiling only needs to absorb a
  // single user's own burst (several tabs polling tracking status every 15s
  // plus normal navigation). Anonymous traffic keeps the tighter IP limit.
  max: (req) => (req.headers.authorization ? 1000 : 250),
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
