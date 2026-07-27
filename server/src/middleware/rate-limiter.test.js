import { describe, it, expect, beforeEach } from 'vitest';
import { apiLimiterKey } from './rate-limiter.js';
import { markTokenVerified, clearVerifiedTokens } from './verified-tokens.js';

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
