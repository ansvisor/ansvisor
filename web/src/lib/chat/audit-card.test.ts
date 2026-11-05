// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AUDIT_TOOL, MAX_AUDIT_CARDS, auditCard, withAuditCard } from './audit-card';
import { chatEvent, clientEventProblems, type ChatAuditCard } from './events';
import { applyChatEvent, emptyRun } from './run-state';

/**
 * A Site Audit's card in Chat: built from the audit read's own result
 * (getSiteAuditFor, list_site_audit_issues), never from the model's words:
 * the page, the score, its range ("64 ± 2") when it has one, when it ran,
 * the change since the page's audit before, and its report.
 */

const ID = '7d3f2c1a-9b8e-4c6d-a5f4-3e2d1c0b9a87';

/** A completed audit as get_site_audit gives it. */
const result = (over: Record<string, unknown> = {}) => ({
  id: ID,
  brandId: 'b1',
  url: 'https://shop.com/bags',
  finalUrl: 'https://shop.com/bags/',
  status: 'completed',
  totalScore: 0.64,
  categoryScores: {},
  signalsEvaluated: 45,
  signalsTotal: 48,
  scoreRange: { plusMinus: 2, low: 62, high: 66, audits: 5 },
  partial: false,
  previousScore: 0.61,
  previousCreatedAt: '2026-10-21T09:00:00Z',
  recommendations: [],
  signals: [],
  error: null,
  createdAt: '2026-10-30T09:00:00Z',
  completedAt: '2026-10-30T09:01:00Z',
  ...over,
});

describe('auditCard', () => {
  it('reads list_site_audit_issues', () => {
    expect(AUDIT_TOOL).toBe('list_site_audit_issues');
  });

  it('shows the page, score, range, date, change and report of a completed audit', () => {
    expect(auditCard(result())).toEqual({
      page: 'https://shop.com/bags/',
      score: 0.64,
      range: { plusMinus: 2, low: 62, high: 66, audits: 5 },
      partial: false,
      auditedAt: '2026-10-30T09:01:00Z',
      change: { points: 3, since: '2026-10-21T09:00:00Z' },
      href: `/dashboard/audit/${ID}`,
    });
  });

  it('shows no range with fewer than 3 audits, and no change for a page audited once', () => {
    const card = auditCard(
      result({ scoreRange: null, previousScore: null, previousCreatedAt: null, finalUrl: null }),
    );
    expect(card).toMatchObject({ page: 'https://shop.com/bags', range: null, change: null });
  });

  it('shows a partial audit with no range or change, even if the result had them', () => {
    expect(auditCard(result({ partial: true }))).toMatchObject({
      partial: true,
      range: null,
      change: null,
      score: 0.64,
    });
  });

  it("shows no range the rule couldn't give, or one the score isn't in", () => {
    // ± 5 isn't half of 66 − 62: altered somewhere on the way.
    expect(
      auditCard(result({ scoreRange: { plusMinus: 5, low: 62, high: 66, audits: 5 } }))?.range,
    ).toBeNull();
    expect(
      auditCard(result({ scoreRange: { plusMinus: 2, low: 70, high: 74, audits: 5 } }))?.range,
    ).toBeNull();
    expect(auditCard(result({ scoreRange: 'NN ± 2' }))?.range).toBeNull();
  });

  it('shows no card for an audit that is running, failed or unscored, or for no audit', () => {
    expect(auditCard(result({ status: 'running', totalScore: null }))).toBeNull();
    expect(auditCard(result({ status: 'failed' }))).toBeNull();
    expect(auditCard(result({ totalScore: null }))).toBeNull();
    expect(auditCard(result({ totalScore: 64 }))).toBeNull();
    expect(auditCard(result({ id: '../settings' }))).toBeNull();
    expect(auditCard(result({ url: '', finalUrl: null }))).toBeNull();
    expect(auditCard(null)).toBeNull();
    expect(auditCard({ code: 'failed' })).toBeNull();
  });

  it('goes to the browser as an event with no id but its report link', () => {
    const event = chatEvent('audit.ready', 1, auditCard(result())!);
    expect(clientEventProblems(event)).toEqual([]);
    const run = applyChatEvent(emptyRun(), event);
    expect(run.audits).toEqual([event.data]);
  });
});

describe('withAuditCard', () => {
  const card = (n: number, over: Partial<ChatAuditCard> = {}): ChatAuditCard => ({
    ...auditCard(result({ id: ID.replace(/7$/, String(n)) }))!,
    ...over,
  });

  it('keeps one card for an audit read twice, the newer, in its place', () => {
    const cards = withAuditCard(withAuditCard([], card(1)), card(2));
    expect(withAuditCard(cards, card(1, { score: 0.7 })).map((c) => c.score)).toEqual([0.7, 0.64]);
  });

  it(`shows ${MAX_AUDIT_CARDS} at most, the first ones read`, () => {
    let cards: ChatAuditCard[] = [];
    for (const n of [1, 2, 3, 4, 5]) cards = withAuditCard(cards, card(n));
    expect(cards.map((c) => c.href.slice(-1))).toEqual(['1', '2', '3']);
  });
});
