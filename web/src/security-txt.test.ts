import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * /.well-known/security.txt (RFC 9116) says where to report a vulnerability:
 * a static file in public/, which the proxy (sign-in redirects, locale
 * routing) leaves alone.
 */

// What the proxy does isn't tested here, only where it runs (and next-intl's
// ESM build doesn't load in Vitest).
vi.mock('next-intl/middleware', () => ({ default: () => () => undefined }));
vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }));

const { config } = await import('./proxy');

const FILE = join(__dirname, '../public/.well-known/security.txt');

function fields(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const line of readFileSync(FILE, 'utf8').split('\n')) {
    const match = /^([A-Za-z-]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    found.set(match[1], [...(found.get(match[1]) ?? []), match[2]]);
  }
  return found;
}

describe('security.txt', () => {
  it('is served as the static file: the proxy never runs for it', () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: 'https://app.ansvisor.com/.well-known/security.txt',
      }),
    ).toBe(false);
    // The proxy still runs for the app's pages.
    expect(
      unstable_doesMiddlewareMatch({ config, url: 'https://app.ansvisor.com/dashboard' }),
    ).toBe(true);
  });

  it("names GitHub's private reporting, the policy and the languages", () => {
    const f = fields();
    expect(f.get('Contact')).toEqual([
      'https://github.com/ansvisor/ansvisor/security/advisories/new',
    ]);
    expect(f.get('Policy')).toEqual(['https://github.com/ansvisor/ansvisor/blob/main/SECURITY.md']);
    expect(f.get('Preferred-Languages')).toEqual(['en, tr']);
    expect(f.get('Canonical')).toEqual(['https://app.ansvisor.com/.well-known/security.txt']);
  });

  it('has one Expires date, not yet past: renew it once a year (RFC 9116 §2.5.5)', () => {
    const expires = fields().get('Expires') ?? [];
    expect(expires).toHaveLength(1);
    expect(expires[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(new Date(expires[0]).getTime()).toBeGreaterThan(Date.now());
  });
});
