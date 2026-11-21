import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * The crawler issues read (get_crawler_access_issues): only once the brand
 * is the person's, every audit read by that brand's id and every check by
 * its own audits' ids, each page's latest audit once.
 */

const brandAllowed = vi.hoisted(() => vi.fn());
vi.mock('./data', () => ({ brandAllowed }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let filters: [string, string, unknown][];

function query(table: string) {
  const where: [string, (value: unknown) => boolean][] = [];
  const matched = () =>
    (tables[table] ?? []).filter((row) => where.every(([column, keep]) => keep(row[column])));
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([table, column, value]);
      where.push([column, (v) => v === value]);
      return chain;
    },
    in: (column: string, values: unknown[]) => {
      filters.push([table, column, values]);
      where.push([column, (v) => values.includes(v)]);
      return chain;
    },
    order: () => chain,
    range: async (start: number, end: number) => ({
      data: matched().slice(start, end + 1),
      error: null,
    }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: matched(), error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => query(table) },
}));

const { getCrawlerAccessFor } = await import('./crawler-access');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const audit = (id: string, url: string, at: string, brand = 'brand-1') => ({
  id,
  brand_id: brand,
  url,
  status: 'completed',
  completed_at: at,
  created_at: at,
});

beforeEach(() => {
  brandAllowed.mockReset().mockResolvedValue(true);
  filters = [];
  tables = {
    // Newest first, as the read orders them.
    site_audits: [
      audit('a2', 'https://acme.example/pricing/', '2026-11-12T00:00:00Z'),
      audit('b1', 'https://acme.example/blog', '2026-11-10T00:00:00Z'),
      audit('a1', 'https://acme.example/pricing', '2026-11-01T00:00:00Z'),
      audit('x1', 'https://other.example/', '2026-11-11T00:00:00Z', 'brand-2'),
    ],
    audit_signal_results: [
      {
        audit_id: 'a2',
        signal_key: 'ai-bot-access',
        status: 'fail',
        evidence: { blockedBots: ['gptbot'] },
      },
      {
        audit_id: 'a1',
        signal_key: 'ai-bot-access',
        status: 'fail',
        evidence: { blockedBots: ['claudebot'] },
      },
      { audit_id: 'b1', signal_key: 'https', status: 'pass', evidence: {} },
      { audit_id: 'x1', signal_key: 'canonical', status: 'fail', evidence: {} },
    ],
  };
});

describe('getCrawlerAccessFor', () => {
  it("reads each of the brand's pages once, by its latest completed audit", async () => {
    const read = await getCrawlerAccessFor(auth, 'brand-1');
    expect(brandAllowed).toHaveBeenCalledWith(auth, 'brand-1');
    expect(read).toMatchObject({ pages: 2, capped: false, bots: { robots_blocked: ['gptbot'] } });
    expect(read?.issues).toEqual([
      expect.objectContaining({ check: 'ai-bot-access', failing: 1, warning: 0 }),
    ]);
    // The audits by the brand's id, completed only; the checks by those audits' ids alone.
    expect(filters).toContainEqual(['site_audits', 'brand_id', 'brand-1']);
    expect(filters).toContainEqual(['site_audits', 'status', 'completed']);
    expect(filters).toContainEqual(['audit_signal_results', 'audit_id', ['a2', 'b1']]);
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandAllowed.mockResolvedValue(false);
    expect(await getCrawlerAccessFor(auth, 'brand-2')).toBeNull();
    expect(filters).toEqual([]);
  });
});
