import { describe, it, expect } from 'vitest';
import { apiLimiterKey } from './rate-limiter.js';

function reqWith({ authorization, ip = '203.0.113.7' } = {}) {
  return { headers: authorization ? { authorization } : {}, ip };
}

describe('rate-limiter – apiLimiterKey', () => {
  it('buckets authenticated requests by token, not by IP', () => {
    const sameTokenA = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1', ip: '1.1.1.1' }));
    const sameTokenB = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1', ip: '2.2.2.2' }));
    expect(sameTokenA).toBe(sameTokenB);
    expect(sameTokenA.startsWith('token:')).toBe(true);
  });

  it('gives different tokens different buckets even from the same IP', () => {
    const a = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1' }));
    const b = apiLimiterKey(reqWith({ authorization: 'Bearer tok-2' }));
    expect(a).not.toBe(b);
  });

  it('never stores the raw token in the key', () => {
    const key = apiLimiterKey(reqWith({ authorization: 'Bearer super-secret-jwt' }));
    expect(key).not.toContain('super-secret-jwt');
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
