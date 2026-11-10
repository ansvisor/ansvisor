import { createHash } from 'node:crypto';
import { safeEqual } from './tokens';

/**
 * PKCE (RFC 7636), S256 only: OAuth 2.1 and the MCP authorization spec
 * require it of every app, and `plain` is refused. The challenge is the
 * base64url sha256 of the verifier, so exactly 43 characters.
 */

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isS256Challenge(value: unknown): value is string {
  return typeof value === 'string' && S256_CHALLENGE.test(value);
}

export function isCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && VERIFIER.test(value);
}

/** The S256 challenge of a verifier. */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Whether the token request's verifier is the one the authorization request's challenge was made from. */
export function verifyS256(verifier: unknown, challenge: string): boolean {
  if (!isCodeVerifier(verifier) || !isS256Challenge(challenge)) return false;
  return safeEqual(s256Challenge(verifier), challenge);
}
