import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The secrets of MCP over OAuth: 32 random bytes each, sent once and kept only
 * as sha256 hashes (00510), as API keys are (00003). Each kind has its own
 * prefix, so the MCP endpoint tells an app's token from an `ans_` key before
 * any lookup, and a leaked one is recognisable.
 */

export const ACCESS_TOKEN_PREFIX = 'ans_oat_';
export const REFRESH_TOKEN_PREFIX = 'ans_ort_';
export const AUTHORIZATION_CODE_PREFIX = 'ans_oac_';
export const CLIENT_SECRET_PREFIX = 'ans_ocs_';
export const CLIENT_ID_PREFIX = 'ansc_';

/** A new secret with its kind's prefix. */
export function newSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/** A new client id for an app that registers itself (RFC 7591). Not a secret. */
export function newClientId(): string {
  return `${CLIENT_ID_PREFIX}${randomBytes(16).toString('base64url')}`;
}

/** The sha256 the database keeps, in hex. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** An app's access token (not an API key, not a refresh token). */
export function isAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}

/** Any secret of MCP over OAuth: never looked up as an API key. */
export function isOAuthSecret(token: string): boolean {
  return [
    ACCESS_TOKEN_PREFIX,
    REFRESH_TOKEN_PREFIX,
    AUTHORIZATION_CODE_PREFIX,
    CLIENT_SECRET_PREFIX,
  ].some((prefix) => token.startsWith(prefix));
}

/** Two strings compared in time that doesn't depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
