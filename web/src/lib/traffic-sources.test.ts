import { describe, expect, it } from 'vitest';
import { googleSourceStatus, gscPropertyHost, snippetDetected } from './traffic-sources';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('snippetDetected', () => {
  it('counts a visit in the last 7 days', () => {
    expect(snippetDetected(daysAgo(0.1), NOW)).toBe(true);
    expect(snippetDetected(daysAgo(6.9), NOW)).toBe(true);
  });

  it('reads an older last visit, or none, as not detected', () => {
    expect(snippetDetected(daysAgo(7.1), NOW)).toBe(false);
    expect(snippetDetected(null, NOW)).toBe(false);
  });
});

describe('googleSourceStatus', () => {
  const ready = { configured: true, connected: true, mapped: true, lastDataAt: daysAgo(0.1) };

  it('is connected once data has arrived, syncing until then', () => {
    expect(googleSourceStatus(ready)).toBe('connected');
    expect(googleSourceStatus({ ...ready, lastDataAt: null })).toBe('syncing');
  });

  it('asks for a property when connected without one for the brand', () => {
    expect(googleSourceStatus({ ...ready, mapped: false, lastDataAt: null })).toBe('unmapped');
  });

  it('is not connected, or not set up on a server without the keys', () => {
    expect(googleSourceStatus({ ...ready, connected: false })).toBe('not_connected');
    expect(googleSourceStatus({ ...ready, configured: false, connected: false })).toBe(
      'not_configured',
    );
  });
});

describe('gscPropertyHost', () => {
  it('names a domain property by its domain, without "sc-domain:"', () => {
    expect(gscPropertyHost('sc-domain:ansvisor.com')).toBe('ansvisor.com');
  });

  it('names a URL-prefix property by its host', () => {
    expect(gscPropertyHost('https://blog.ansvisor.com/')).toBe('blog.ansvisor.com');
  });

  it('leaves anything else as it is', () => {
    expect(gscPropertyHost('ansvisor.com')).toBe('ansvisor.com');
  });
});
