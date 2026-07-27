import { createHash } from 'node:crypto';

/**
 * Short-lived cache of Authorization headers that decodeToken has already
 * verified against Supabase Auth, mapped to their user id. The rate limiter
 * consults it to give real users per-user buckets WITHOUT trusting the header
 * blindly: a forged or garbage token never gets verified, so it never earns a
 * bucket of its own and keeps counting against the caller's IP limit.
 *
 * Only the SHA-256 of the header is stored, never the raw JWT. Entries expire
 * after 30 minutes (well under the token's own lifetime) and the map is
 * capped, evicting oldest-inserted first, so it can't grow unbounded.
 */
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map();

function hashAuthHeader(authorizationHeader) {
  return createHash('sha256').update(authorizationHeader).digest('hex').slice(0, 32);
}

export function markTokenVerified(authorizationHeader, userId) {
  if (!authorizationHeader || !userId) return;
  if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(hashAuthHeader(authorizationHeader), {
    userId,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function verifiedUserId(authorizationHeader) {
  if (!authorizationHeader) return null;
  const key = hashAuthHeader(authorizationHeader);
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.userId;
}

// Test hook — the limiter's behavior depends on cache state.
export function clearVerifiedTokens() {
  cache.clear();
}
