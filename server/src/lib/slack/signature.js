import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack's request signing, for the clicks on Approve and Reject (#2139, N7):
 * every request Slack sends to the app's Interactivity Request URL carries
 * X-Slack-Request-Timestamp and X-Slack-Signature, which is `v0=` and the
 * hex HMAC-SHA256 of `v0:{timestamp}:{raw body}` under the Slack app's
 * signing secret (SLACK_SIGNING_SECRET). Checked on the body's bytes as they
 * came, compared in constant time, with the timestamp within MAX_SKEW_S of
 * now, so a recorded request can't be sent again later. Pure.
 */

/** How far Slack's timestamp may be from now, either way. */
export const MAX_SKEW_S = 5 * 60;

const SIGNATURE = /^v0=[0-9a-f]{64}$/i;
const TIMESTAMP = /^\d{1,12}$/;

/** The Slack app's signing secret, or null when none is set: then every request is refused. */
export function slackSigningSecret(env = process.env) {
  const secret =
    typeof env.SLACK_SIGNING_SECRET === 'string' ? env.SLACK_SIGNING_SECRET.trim() : '';
  return secret || null;
}

/**
 * Whether a request is Slack's own, as it was sent.
 * @param {{ secret: string|null, timestamp: unknown, signature: unknown, rawBody: unknown, now?: number }} input
 * @returns {'ok' | 'no_secret' | 'missing' | 'stale' | 'mismatch'}
 */
export function checkSlackSignature({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret) return 'no_secret';
  if (typeof timestamp !== 'string' || !TIMESTAMP.test(timestamp)) return 'missing';
  if (typeof signature !== 'string' || !SIGNATURE.test(signature)) return 'missing';
  if (!Buffer.isBuffer(rawBody)) return 'missing';
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_S) return 'stale';
  const expected = createHmac('sha256', secret).update(`v0:${timestamp}:`).update(rawBody).digest();
  const given = Buffer.from(signature.slice(3), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'mismatch';
}
