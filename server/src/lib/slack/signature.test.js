import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_SKEW_S, checkSlackSignature, slackSigningSecret } from './signature.js';

/**
 * Slack's request signing (#2139, N7): v0= and the HMAC-SHA256 of
 * `v0:{timestamp}:{raw body}`, compared in constant time, the timestamp
 * within 5 minutes; with no secret, nothing passes.
 */

const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const NOW = 1_762_770_000_000;
const TS = String(NOW / 1000);
const BODY = Buffer.from('payload=%7B%22type%22%3A%22block_actions%22%7D');
const sign = (body, ts = TS, secret = SECRET) =>
  `v0=${createHmac('sha256', secret).update(`v0:${ts}:`).update(body).digest('hex')}`;
const check = (over = {}) =>
  checkSlackSignature({
    secret: SECRET,
    timestamp: TS,
    signature: sign(BODY),
    rawBody: BODY,
    now: NOW,
    ...over,
  });

describe('checkSlackSignature', () => {
  it("passes Slack's own request, as it was sent", () => {
    expect(check()).toBe('ok');
    expect(check({ signature: sign(BODY).toUpperCase().replace('V0=', 'v0=') })).toBe('ok');
  });

  it('refuses everything with no secret on the server', () => {
    expect(check({ secret: null })).toBe('no_secret');
    expect(slackSigningSecret({})).toBeNull();
    expect(slackSigningSecret({ SLACK_SIGNING_SECRET: '  ' })).toBeNull();
    expect(slackSigningSecret({ SLACK_SIGNING_SECRET: SECRET })).toBe(SECRET);
  });

  it('refuses a request without its headers, or a body that was parsed', () => {
    expect(check({ signature: undefined })).toBe('missing');
    expect(check({ timestamp: undefined })).toBe('missing');
    expect(check({ signature: 'v1=abc' })).toBe('missing');
    expect(check({ timestamp: '17627e9' })).toBe('missing');
    expect(check({ rawBody: { payload: '{}' } })).toBe('missing');
  });

  it('refuses a timestamp more than 5 minutes off, either way', () => {
    const late = String(NOW / 1000 - MAX_SKEW_S - 1);
    const early = String(NOW / 1000 + MAX_SKEW_S + 1);
    expect(check({ timestamp: late, signature: sign(BODY, late) })).toBe('stale');
    expect(check({ timestamp: early, signature: sign(BODY, early) })).toBe('stale');
    const edge = String(NOW / 1000 - MAX_SKEW_S);
    expect(check({ timestamp: edge, signature: sign(BODY, edge) })).toBe('ok');
  });

  it('refuses a body with one byte changed, another timestamp, or another secret', () => {
    const changed = Buffer.from(BODY);
    changed[changed.length - 2] ^= 1;
    expect(check({ rawBody: changed })).toBe('mismatch');
    const other = String(NOW / 1000 - 1);
    expect(check({ timestamp: other })).toBe('mismatch');
    expect(check({ signature: sign(BODY, TS, 'another-secret') })).toBe('mismatch');
  });
});
