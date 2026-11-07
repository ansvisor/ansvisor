import { describe, expect, it, vi } from 'vitest';

/**
 * The audits family raises canonical_issue (AC plan P-11) from the
 * canonical check's evidence on each page's latest audit: a missing tag,
 * or one pointing to another site, a redirect, a noindex or a missing page.
 * A tag that passes the score can still be one.
 */

/** As the family reads them: the brand's, completed. */
const AUDIT = { brand_id: 'b1', status: 'completed' };

const tables = {
  site_audits: [
    {
      id: 'a1',
      url: 'https://acme.example/pricing',
      final_url: null,
      completed_at: '2026-11-01',
      ...AUDIT,
    },
    {
      id: 'a2',
      url: 'https://acme.example/blog',
      final_url: null,
      completed_at: '2026-11-01',
      ...AUDIT,
    },
    {
      id: 'a3',
      url: 'https://acme.example/about',
      final_url: null,
      completed_at: '2026-11-01',
      ...AUDIT,
    },
    {
      id: 'a4',
      url: 'https://acme.example/plans',
      final_url: null,
      completed_at: '2026-11-01',
      ...AUDIT,
    },
  ],
  audit_signal_results: [
    {
      audit_id: 'a1',
      signal_key: 'canonical',
      status: 'pass',
      evidence: {
        canonical: '/old-pricing',
        target: {
          state: 'redirect',
          target: 'https://acme.example/old-pricing',
          to: 'https://acme.example/pricing',
        },
      },
    },
    { audit_id: 'a2', signal_key: 'canonical', status: 'fail', evidence: { canonical: null } },
    {
      audit_id: 'a3',
      signal_key: 'canonical',
      status: 'pass',
      evidence: {
        canonical: '/about',
        target: { state: 'self', target: 'https://acme.example/about' },
      },
    },
    // Audited before the target was read.
    { audit_id: 'a4', signal_key: 'canonical', status: 'pass', evidence: { canonical: '/plans' } },
  ],
};

function builder(table) {
  const filters = [];
  const chain = {
    select: () => chain,
    eq: (col, value) => (filters.push((row) => row[col] === value), chain),
    gte: () => chain,
    in: (col, values) => (filters.push((row) => values.includes(row[col])), chain),
    order: () => chain,
    range: async () => ({
      data: (tables[table] ?? []).filter((row) => filters.every((f) => f(row))),
      error: null,
    }),
  };
  return chain;
}

vi.mock('../../../config/supabase.js', () => ({
  default: { from: (table) => builder(table), rpc: vi.fn() },
}));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');

describe('the audits family on canonical tags', () => {
  it('raises one finding with each page whose tag is missing or points where it shouldn’t', async () => {
    const audits = LIBRARY_FAMILIES.find((f) => f.name === 'audits');
    expect(audits.kinds).toContain('canonical_issue');
    const found = await audits.run({ brandId: 'b1', now: new Date('2026-11-07T00:00:00Z') });
    const canonical = found.find((f) => f.kind === 'canonical_issue');
    expect(canonical.payload.targets).toEqual([
      {
        id: 'https://acme.example/pricing',
        label: 'https://acme.example/pricing',
        issue: 'redirect',
        canonical: '/old-pricing',
        to: 'https://acme.example/pricing',
      },
      {
        id: 'https://acme.example/blog',
        label: 'https://acme.example/blog',
        issue: 'missing',
        canonical: null,
      },
    ]);
  });
});
