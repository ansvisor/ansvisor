// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * get_site_audit (MCP, Chat's list_site_audit_issues and the Agent) gives the
 * score's range, "64 ± 2" in the audit report (customer priorities item 1):
 * from the page's last complete audits up to this one, by the report's rule,
 * or null with fewer than 3.
 */

const db = vi.hoisted(() => ({
  audit: null as Record<string, unknown> | null,
  /** The brand's complete audits before the audit, newest first. */
  history: [] as Record<string, unknown>[],
  historyError: null as { message: string } | null,
  historyReads: 0,
}));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'not', 'lt', 'order']) chain[name] = () => chain;
    chain.maybeSingle = async () => ({ data: table === 'site_audits' ? db.audit : null });
    chain.range = async (start: number, end: number) => {
      db.historyReads += 1;
      return db.historyError
        ? { data: null, error: db.historyError }
        : { data: db.history.slice(start, end + 1), error: null };
    };
    chain.then = (resolve: (value: unknown) => void) =>
      resolve({
        data:
          table === 'audit_signal_results'
            ? [{ signal_key: 'faq-schema', category: 'structure', status: 'pass', score: 1 }]
            : [],
        error: null,
      });
    return chain;
  };
  return { supabaseAdmin: { from } };
});

const { getSiteAuditFor } = await import('./data');

const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'manager',
  apiKeyId: 'key-1',
  brandAccess: 'all',
};

const past = (url: string, score: number, day: number) => ({
  url,
  final_url: null,
  total_score: score,
  created_at: `2026-10-${day}T09:00:00Z`,
});

beforeEach(() => {
  db.audit = {
    id: 'a1',
    brand_id: 'b1',
    url: 'https://shop.com/bags',
    final_url: 'https://shop.com/bags/',
    status: 'completed',
    partial: false,
    total_score: 0.64,
    category_scores: {},
    signals_evaluated: 45,
    signals_total: 48,
    recommendations: [],
    error: null,
    created_at: '2026-10-30T09:00:00Z',
    completed_at: '2026-10-30T09:01:00Z',
  };
  db.history = [
    past('https://www.shop.com/bags', 0.62, 28),
    past('https://shop.com/shoes', 0.9, 27),
    past('https://shop.com/bags', 0.66, 21),
  ];
  db.historyError = null;
  db.historyReads = 0;
});

describe('getSiteAuditFor › scoreRange', () => {
  it("gives the range from the page's own audits, with the audit's signals", async () => {
    const audit = await getSiteAuditFor(AUTH, 'a1');
    expect(audit?.scoreRange).toEqual({ plusMinus: 2, low: 62, high: 66, audits: 3 });
    expect(audit?.totalScore).toBe(0.64);
    expect(audit?.signals).toHaveLength(1);
  });

  it('is null with fewer than three complete audits of the page', async () => {
    db.history = [past('https://shop.com/bags', 0.62, 28), past('https://shop.com/shoes', 0.9, 27)];
    expect((await getSiteAuditFor(AUTH, 'a1'))?.scoreRange).toBeNull();
  });

  it("is null, with no history read, for an audit that isn't compared", async () => {
    db.audit = { ...db.audit, partial: true };
    expect((await getSiteAuditFor(AUTH, 'a1'))?.scoreRange).toBeNull();
    db.audit = { ...db.audit, partial: false, status: 'running', total_score: null };
    expect((await getSiteAuditFor(AUTH, 'a1'))?.scoreRange).toBeNull();
    expect(db.historyReads).toBe(0);
  });

  it('still gives the audit when the history read fails, without a range', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.historyError = { message: 'timeout' };
    const audit = await getSiteAuditFor(AUTH, 'a1');
    expect(audit?.id).toBe('a1');
    expect(audit?.scoreRange).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
