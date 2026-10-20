import { describe, it, expect, beforeEach } from 'vitest';
import { apiLimiterKey, botIngestKey, webhookCallbackKey } from './rate-limiter.js';
import {
  markBotSenderVerified,
  markTokenVerified,
  clearVerifiedTokens,
} from './verified-tokens.js';

function reqWith({ authorization, ip = '203.0.113.7' } = {}) {
  return { headers: authorization ? { authorization } : {}, ip };
}

describe('rate-limiter – apiLimiterKey', () => {
  beforeEach(() => clearVerifiedTokens());

  it('keeps unverified Authorization headers in the caller IP bucket', () => {
    const forged = apiLimiterKey(reqWith({ authorization: 'Bearer forged-1', ip: '1.1.1.1' }));
    const forged2 = apiLimiterKey(reqWith({ authorization: 'Bearer forged-2', ip: '1.1.1.1' }));
    const anonymous = apiLimiterKey(reqWith({ ip: '1.1.1.1' }));
    expect(forged).toBe(anonymous);
    expect(forged2).toBe(anonymous);
  });

  it('buckets verified tokens by user across IPs', () => {
    markTokenVerified('Bearer tok-1', 'user-a');
    const a = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1', ip: '1.1.1.1' }));
    const b = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1', ip: '2.2.2.2' }));
    expect(a).toBe('user:user-a');
    expect(b).toBe('user:user-a');
  });

  it('maps a refreshed token for the same user to the same bucket', () => {
    markTokenVerified('Bearer tok-old', 'user-a');
    markTokenVerified('Bearer tok-new', 'user-a');
    const oldKey = apiLimiterKey(reqWith({ authorization: 'Bearer tok-old' }));
    const newKey = apiLimiterKey(reqWith({ authorization: 'Bearer tok-new' }));
    expect(oldKey).toBe(newKey);
  });

  it('gives different verified users different buckets', () => {
    markTokenVerified('Bearer tok-1', 'user-a');
    markTokenVerified('Bearer tok-2', 'user-b');
    const a = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1' }));
    const b = apiLimiterKey(reqWith({ authorization: 'Bearer tok-2' }));
    expect(a).not.toBe(b);
  });

  it('falls back to the caller IP for anonymous requests', () => {
    const a = apiLimiterKey(reqWith({ ip: '1.1.1.1' }));
    const b = apiLimiterKey(reqWith({ ip: '2.2.2.2' }));
    expect(a).not.toBe(b);
    expect(a).toContain('1.1.1.1');
  });

  it('collapses an IPv6 subnet into one anonymous bucket', () => {
    const a = apiLimiterKey(reqWith({ ip: '2001:db8:abcd:12::1' }));
    const b = apiLimiterKey(reqWith({ ip: '2001:db8:abcd:12::2' }));
    expect(a).toBe(b);
  });

  it('keeps v4-mapped IPv6 addresses distinct per IPv4 address', () => {
    const a = apiLimiterKey(reqWith({ ip: '::ffff:1.1.1.1' }));
    const b = apiLimiterKey(reqWith({ ip: '::ffff:2.2.2.2' }));
    expect(a).not.toBe(b);
  });
});

describe('rate-limiter – botIngestKey', () => {
  beforeEach(() => clearVerifiedTokens());

  it('buckets a matched secret by its connection, whatever the address', () => {
    markBotSenderVerified('Bearer abot_one', 'c1');
    markBotSenderVerified('Bearer abot_two', 'c2');
    const a = botIngestKey(reqWith({ authorization: 'Bearer abot_one', ip: '1.1.1.1' }));
    const b = botIngestKey(reqWith({ authorization: 'Bearer abot_one', ip: '2.2.2.2' }));
    const other = botIngestKey(reqWith({ authorization: 'Bearer abot_two', ip: '1.1.1.1' }));
    expect(a).toBe('bot:c1');
    expect(b).toBe('bot:c1');
    expect(other).toBe('bot:c2');
  });

  it('keeps unknown secrets in the caller IP bucket, so made-up ones share it', () => {
    const one = botIngestKey(reqWith({ authorization: 'Bearer abot_made_up_1', ip: '1.1.1.1' }));
    const two = botIngestKey(reqWith({ authorization: 'Bearer abot_made_up_2', ip: '1.1.1.1' }));
    expect(one).toBe('ip:1.1.1.1');
    expect(two).toBe('ip:1.1.1.1');
  });

  it('falls back to the IP without a secret', () => {
    expect(botIngestKey(reqWith({ ip: '1.1.1.1' }))).toBe('ip:1.1.1.1');
  });

  it("never gives a bot secret a dashboard user's bucket", () => {
    markBotSenderVerified('Bearer abot_one', 'c1');
    expect(apiLimiterKey(reqWith({ authorization: 'Bearer abot_one', ip: '1.1.1.1' }))).toBe(
      'ip:1.1.1.1',
    );
  });
});

describe('rate-limiter – webhookCallbackKey', () => {
  it('buckets callbacks by the secret hash across shared provider IPs', () => {
    const a = webhookCallbackKey({ headers: { 'x-webhook-secret': 'shared-one' }, ip: '1.1.1.1' });
    const b = webhookCallbackKey({ headers: { 'x-webhook-secret': 'shared-one' }, ip: '2.2.2.2' });
    const other = webhookCallbackKey({
      headers: { 'x-webhook-secret': 'shared-two' },
      ip: '1.1.1.1',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).toMatch(/^webhook:[0-9a-f]{64}$/);
    expect(a).not.toContain('shared-one');
  });

  it('falls back to the anonymous IP bucket when the secret is missing', () => {
    expect(webhookCallbackKey({ headers: {}, ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
  });
});
