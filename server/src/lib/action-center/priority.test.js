import { describe, expect, it } from 'vitest';
import { priorityColumns, priorityLevel, promptIdsOf, scorePriority } from './priority.js';

/**
 * The priority score (AC-006): how soon to work on an action, 0–100, from
 * impact, demand, severity, business value, independent confirmation,
 * recoverability and recency — and never from how many signals repeat.
 */

const NOW = new Date('2026-10-15T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const action = (over = {}) => ({
  kind: 'recover_lost_citations',
  category: 'recover',
  impact: 'high',
  payload: {},
  ...over,
});
const signal = (over = {}) => ({
  kind: 'lost_citations',
  impact: 'high',
  source: ['ai_results'],
  detected_at: daysAgo(1),
  payload: {},
  ...over,
});
const demand = (entries) =>
  new Map(entries.map(([id, volume, intent]) => [id, { volume, intent }]));

describe('priorityLevel', () => {
  it('maps a score to the spec’s levels', () => {
    expect([100, 90, 89, 75, 74, 50, 49, 0].map(priorityLevel)).toEqual([
      'critical',
      'critical',
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
    ]);
  });
});

describe('scorePriority', () => {
  it('scores a recent loss on high-demand commercial prompts as critical', () => {
    const { score, level, reason } = scorePriority(
      {
        action: action({ payload: { targetEntity: 'prompts', targetCount: 7 } }),
        signals: [signal({ payload: { promptId: 'p1' } })],
        prompts: demand([['p1', 25_000, 'comparison']]),
      },
      NOW,
    );
    expect(score).toBeGreaterThanOrEqual(90);
    expect(level).toBe('critical');
    expect(reason).toMatchObject({
      change: 'lost',
      subject: { entity: 'prompts', count: 7 },
      demand: 'high',
      searches: 25_000,
      commercial: true,
      heldBefore: true,
      days: 1,
    });
  });

  /** The spec's fixture: quantity is not priority. */
  it('puts one high-demand commercial loss before forty-seven low-demand findings', () => {
    const tail = Array.from({ length: 47 }, (_, i) => [`t${i}`, 5, 'what-is']);
    const many = scorePriority(
      {
        action: action({ kind: 'create_content_for_demand', category: 'growth' }),
        signals: tail.map(([id]) =>
          signal({
            kind: 'uncovered_demand',
            payload: { entity: 'prompts', targets: [{ id, volume: 5 }] },
          }),
        ),
        prompts: demand(tail),
      },
      NOW,
    );
    const one = scorePriority(
      {
        action: action(),
        signals: [signal({ payload: { promptId: 'hot' } })],
        prompts: demand([['hot', 2000, 'comparison']]),
      },
      NOW,
    );
    expect(one.score).toBeGreaterThan(many.score);
  });

  it('counts the most demanded few targets, not all of them', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => [`p${i}`, 100, 'other']);
    const five = Array.from({ length: 5 }, (_, i) => [`q${i}`, 1000, 'other']);
    const score = (list) =>
      scorePriority(
        {
          action: action({
            kind: 'expand_prompt_visibility',
            category: 'growth',
            impact: 'medium',
          }),
          signals: [
            signal({
              kind: 'prompt_visibility_gap',
              payload: { entity: 'prompts', targets: list.map(([id]) => ({ id })) },
            }),
          ],
          prompts: demand(list),
        },
        NOW,
      ).reason.factors.demand;
    expect(score(five)).toBeGreaterThan(score(fifty));
  });

  /** Impact is one factor of seven, not the whole answer. */
  it('can put a medium-impact loss on high demand before a high-impact gap nobody searches', () => {
    const loss = scorePriority(
      {
        action: action({ impact: 'medium' }),
        signals: [signal({ impact: 'medium', payload: { promptId: 'hot' } })],
        prompts: demand([['hot', 5000, 'best-top']]),
      },
      NOW,
    );
    const gap = scorePriority(
      {
        action: action({ kind: 'close_competitor_gap', category: 'compete' }),
        signals: [
          signal({
            kind: 'competitor_leads',
            payload: { promptId: 'cold' },
            detected_at: daysAgo(20),
          }),
        ],
        prompts: demand([['cold', 0, 'other']]),
      },
      NOW,
    );
    expect(loss.score).toBeGreaterThan(gap.score);
  });

  it('weighs independent kinds and sources, not repeats of one signal', () => {
    const once = scorePriority({ action: action(), signals: [signal()] }, NOW);
    const repeated = scorePriority(
      { action: action(), signals: Array.from({ length: 30 }, () => signal()) },
      NOW,
    );
    const confirmed = scorePriority(
      {
        action: action(),
        signals: [signal(), signal({ kind: 'lost_mentions', source: ['gsc'] })],
      },
      NOW,
    );
    expect(repeated.score).toBe(once.score);
    expect(confirmed.reason).toMatchObject({ kinds: 2, sources: 2 });
    expect(confirmed.score).toBeGreaterThan(once.score);
  });

  it('lets old evidence fade', () => {
    const fresh = scorePriority({ action: action(), signals: [signal()] }, NOW);
    const old = scorePriority(
      { action: action(), signals: [signal({ detected_at: daysAgo(30) })] },
      NOW,
    );
    expect(old.score).toBeLessThan(fresh.score);
    expect(old.reason.days).toBe(30);
  });

  it('ranks ground the brand held and lost above ground it never had', () => {
    const lost = scorePriority(
      {
        action: action({ impact: 'medium' }),
        signals: [signal({ kind: 'topic_drop', impact: 'medium' })],
      },
      NOW,
    ).reason;
    const never = scorePriority(
      {
        action: action({ category: 'growth', impact: 'medium' }),
        signals: [signal({ kind: 'topic_uncovered', impact: 'medium' })],
      },
      NOW,
    ).reason;
    expect(lost.heldBefore).toBe(true);
    expect(lost.factors.recoverability).toBeGreaterThan(never.factors.recoverability);
    expect(lost.factors.severity).toBeGreaterThan(never.factors.severity);
  });

  it('calls ground never held a gap, whatever its impact', () => {
    const { reason } = scorePriority(
      {
        action: action({ kind: 'create_content_for_demand', category: 'growth' }),
        signals: [signal({ kind: 'uncovered_demand' }), signal({ kind: 'competitor_leads' })],
      },
      NOW,
    );
    expect(reason).toMatchObject({ change: 'gap', heldBefore: false });
    expect(reason.factors.severity).toBe(0.5);
  });

  it("does not read an owned page's citations as its visits", () => {
    const { reason } = scorePriority(
      {
        action: action({ kind: 'recover_page_citations' }),
        signals: [
          signal({
            kind: 'owned_page_citation_lost',
            payload: { entity: 'pages', targets: [{ id: '/pricing', before: 6, now: 0 }] },
          }),
        ],
      },
      NOW,
    );
    expect(reason.demand).toBeNull();
  });

  it('weighs an action whose findings all resolved as having nothing open', () => {
    const { reason } = scorePriority({ action: action(), signals: [] }, NOW);
    expect(reason.change).toBeNull();
    expect(reason.factors.severity).toBe(0.3);
  });

  it('does not call unmeasured demand low', () => {
    const { reason } = scorePriority({ action: action(), signals: [signal()] }, NOW);
    expect(reason.demand).toBeNull();
    expect(reason.searches).toBeNull();
  });

  it('reads demand from search impressions and page sessions too', () => {
    const queries = scorePriority(
      {
        action: action({ kind: 'recover_search_demand', category: 'protect' }),
        signals: [
          signal({
            kind: 'gsc_decline',
            payload: { entity: 'queries', targets: [{ id: 'coffee', impressions: 4000 }] },
          }),
        ],
      },
      NOW,
    );
    const pages = scorePriority(
      {
        action: action({ kind: 'capture_ai_traffic', category: 'growth', impact: 'medium' }),
        signals: [
          signal({
            kind: 'page_opportunity',
            current_value: 900,
            payload: { landingPage: '/pricing', valueSignal: 'revenue' },
          }),
        ],
      },
      NOW,
    );
    expect(queries.reason.demand).toBe('high');
    expect(pages.reason).toMatchObject({ demand: 'high', commercial: true, change: 'opportunity' });
  });

  it('scores an action a person sent, from its own payload', () => {
    const improve = scorePriority(
      {
        action: action({
          kind: 'prompt_improve',
          category: 'compete',
          impact: 'medium',
          created_at: daysAgo(0),
          payload: {
            promptIds: ['p1'],
            platforms: [
              { id: 'gemini-web', state: 'not_mentioned' },
              { id: 'chatgpt-web', state: 'not_cited' },
            ],
          },
        }),
        prompts: demand([['p1', 300, 'recommendation']]),
      },
      NOW,
    );
    expect(improve.reason).toMatchObject({
      change: 'gap',
      subject: { entity: 'platforms', count: 2 },
      demand: 'medium',
      commercial: true,
      days: null,
    });
    const content = scorePriority(
      {
        action: action({
          kind: 'content_opportunity',
          category: 'growth',
          impact: 'high',
          created_at: daysAgo(0),
          payload: { promptIds: ['p1'], targetEntity: 'prompts', targetCount: 4 },
        }),
        prompts: demand([['p1', 300, 'how-to']]),
      },
      NOW,
    );
    expect(content.reason.subject).toEqual({ entity: 'prompts', count: 4 });
    expect(content.score).toBeGreaterThan(0);
  });

  it('scores pages sent from AI Traffic on their list, sessions and value (AT-006)', () => {
    const sent = (reason, payload = {}) =>
      scorePriority(
        {
          action: action({
            kind: 'traffic_pages',
            category: reason === 'cited_not_clicked' ? 'fix' : 'growth',
            impact: 'medium',
            created_at: daysAgo(0),
            payload: {
              source: 'traffic_pages',
              reason,
              targetEntity: 'pages',
              targetCount: 2,
              targets: [
                { id: '/shop/beans', sessions: 240 },
                { id: '/guides/espresso', sessions: 0 },
              ],
              ...payload,
            },
          }),
        },
        NOW,
      );
    const cited = sent('cited_not_clicked');
    expect(cited.reason).toMatchObject({
      change: 'gap',
      subject: { entity: 'pages', count: 2 },
      // The pages' sessions are its demand.
      demand: expect.any(String),
    });
    expect(cited.reason.factors.severity).toBe(0.55);
    // Answers already cite it: more certain, and closer to done, than a page AI skips.
    const skipped = sent('no_ai_traffic');
    expect(skipped.reason.factors.severity).toBe(0.45);
    expect(cited.score).toBeGreaterThan(skipped.score);
    // Pages that make money are worth more.
    expect(sent('no_ai_traffic', { valueSignal: 'revenue' }).score).toBeGreaterThan(skipped.score);
    expect(sent('no_ai_traffic', { valueSignal: 'revenue' }).reason.commercial).toBe(true);
  });

  it('stays within 0–100 and returns whole numbers', () => {
    for (const impact of ['high', 'medium', 'low', 'unknown']) {
      const { score } = scorePriority({ action: action({ impact }), signals: [] }, NOW);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('promptIdsOf', () => {
  it('finds the prompts payloads name, once each', () => {
    expect(
      promptIdsOf([
        { promptId: 'a' },
        { promptIds: ['a', 'b'] },
        { entity: 'prompts', targets: [{ id: 'c' }] },
        { targetEntity: 'prompts', targets: [{ id: 'd' }] },
        { entity: 'pages', targets: [{ id: '/pricing' }] },
        null,
      ]),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('priorityColumns', () => {
  it('names the columns the score is stored in', () => {
    expect(
      priorityColumns({ score: 94, level: 'critical', reason: { change: 'lost' } }, NOW),
    ).toEqual({
      priority_score: 94,
      priority_level: 'critical',
      priority_reason: { change: 'lost' },
      priority_updated_at: NOW.toISOString(),
    });
  });
});
