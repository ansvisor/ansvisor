import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OPEN_OPPORTUNITY_STATUSES,
  OPPORTUNITIES_PER_RUN,
  SCORE_WEIGHTS,
  clusterMetrics,
  coveredClusterIds,
  dismissedLongAgo,
  openOpportunityOn,
  openlyCoveredClusterIds,
  opportunityScore,
  pickClusters,
  requestScope,
  scoreComponents,
} from './opportunity-limits.js';

const source = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const prompts = new Map([
  [
    'a',
    {
      text: 'best tools for x',
      volume: { est_ai_volume: 3000, intent: 'best-top', keywords: ['x tools', 'x software'] },
      metrics: { cells: 30, visibility: 10, top_competitor_visibility: 60, competitors: ['Rival'] },
    },
  ],
  [
    'b',
    {
      text: 'top x software',
      volume: { est_ai_volume: 1000, intent: 'best-top', keywords: ['x software'] },
      metrics: {
        cells: 10,
        visibility: 50,
        top_competitor_visibility: 40,
        competitors: ['Rival', 'Other'],
      },
    },
  ],
  // Tracked but not answered in the window: adds demand, not visibility.
  ['c', { text: 'how to pick x', volume: { est_ai_volume: 500, intent: 'how-to', keywords: [] } }],
]);

describe('clusterMetrics', () => {
  it('adds demand and weights visibility by engine-days', () => {
    const m = clusterMetrics(['a', 'b', 'c', 'gone'], prompts);
    expect(m.tested).toBe(2);
    expect(m.demand).toBe(4500);
    // (10×30 + 50×10) / 40 and (60×30 + 40×10) / 40
    expect(m.visibility).toBe(20);
    expect(m.topCompetitorVisibility).toBe(55);
    expect(m.competitorGap).toBe(35);
    expect(m.intent).toBe('best-top');
    expect(m.keywords[0]).toBe('x software');
    expect(m.competitorsCited).toEqual(['Rival', 'Other']);
    // Its question's own volume, not the cluster's sum.
    expect(m.representative).toEqual({ id: 'a', text: 'best tools for x', volume: 3000 });
  });

  it('reports a cluster with no answers as untested', () => {
    const m = clusterMetrics(['c'], prompts);
    expect(m.tested).toBe(0);
    expect(m.visibility).toBe(0);
    expect(m.representative).toEqual({ id: 'c', text: 'how to pick x', volume: 500 });
  });
});

describe('score', () => {
  it('scales each component to 0–100', () => {
    expect(
      scoreComponents({ demand: 2_000_000, visibility: 20, competitorGap: -5, intent: 'how-to' }),
    ).toEqual({ demand: 100, visibilityGap: 80, competitorGap: 0, intent: 75 });
  });

  it('puts demand on a log scale so large clusters still differ', () => {
    const demand = (d) =>
      scoreComponents({ demand: d, visibility: 0, competitorGap: 0, intent: 'other' }).demand;
    expect(demand(0)).toBe(0);
    expect(demand(1000)).toBe(50);
    expect(demand(10000)).toBe(66.7);
    expect(demand(150000)).toBeLessThan(demand(1_000_000));
  });

  it('weights the components into the total', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(opportunityScore({ demand: 100, visibilityGap: 80, competitorGap: 0, intent: 75 })).toBe(
      71.5,
    );
  });
});

describe('cluster selection', () => {
  it('counts both own and merged clusters as covered', () => {
    const covered = coveredClusterIds([
      { cluster_id: 'c1', related_cluster_ids: ['c2'] },
      { cluster_id: 'c3', related_cluster_ids: [] },
    ]);
    expect([...covered].sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('lets a need dismissed over 90 days ago be suggested again, as the dismiss dialog says', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString();
    const rows = [
      {
        cluster_id: 'c1',
        related_cluster_ids: ['c2'],
        status: 'dismissed',
        updated_at: daysAgo(91),
      },
      { cluster_id: 'c3', related_cluster_ids: [], status: 'dismissed', updated_at: daysAgo(89) },
      { cluster_id: 'c4', related_cluster_ids: [], status: 'dismissed' },
      { cluster_id: 'c5', related_cluster_ids: [], status: 'done', updated_at: daysAgo(400) },
      { cluster_id: 'c6', related_cluster_ids: [], status: 'archived', updated_at: daysAgo(400) },
    ];
    expect([...coveredClusterIds(rows, now)].sort()).toEqual(['c3', 'c4', 'c5', 'c6']);
    expect(dismissedLongAgo(rows[0], now)).toBe(true);
    expect(dismissedLongAgo(rows[4], now)).toBe(false);
  });

  it('reads the date coverage needs with the opportunities', () => {
    expect(source('./open-opportunities.js')).toMatch(
      /'id, title, status, created_at, updated_at,/,
    );
  });

  it("holds a prompt's own request back only with an open opportunity (PROMPT-006)", () => {
    const rows = [
      { cluster_id: 'c1', related_cluster_ids: ['c2'], status: 'in_progress' },
      { cluster_id: 'c3', related_cluster_ids: [], status: 'dismissed' },
      { cluster_id: 'c4', related_cluster_ids: [], status: 'done' },
      { cluster_id: 'c5', related_cluster_ids: [], status: 'archived' },
    ];
    expect([...openlyCoveredClusterIds(rows)].sort()).toEqual(['c1', 'c2']);
    expect(OPEN_OPPORTUNITY_STATUSES).toEqual(['new', 'reviewed', 'sent', 'in_progress']);
  });

  it('names the open opportunity that covers a cluster, merged ones included', () => {
    const rows = [
      { id: 'o1', cluster_id: 'c1', related_cluster_ids: [], status: 'dismissed' },
      { id: 'o2', cluster_id: 'c9', related_cluster_ids: ['c1'], status: 'sent' },
    ];
    expect(openOpportunityOn(rows, 'c1')).toBe('o2');
    expect(openOpportunityOn(rows, 'c2')).toBeNull();
    expect(openOpportunityOn(rows, null)).toBeNull();
  });

  it('takes the best uncovered clusters that have answers', () => {
    const cand = (id, score, tested = 1) => ({ id, score, topicId: id, metrics: { tested } });
    const picked = pickClusters(
      [
        cand('low', 10),
        cand('covered', 90),
        cand('untested', 80, 0),
        cand('high', 70),
        cand('mid', 40),
      ],
      new Set(['covered']),
      2,
    );
    expect(picked.map((c) => c.id)).toEqual(['high', 'mid']);
  });

  it('takes at most one cluster per topic, the no-topic scope included', () => {
    const cand = (id, score, topicId) => ({ id, score, topicId, metrics: { tested: 1 } });
    const picked = pickClusters(
      [
        cand('a1', 95, 'a'),
        cand('a2', 90, 'a'),
        cand('none1', 85, null),
        cand('none2', 80, null),
        cand('b1', 50, 'b'),
      ],
      new Set(),
    );
    expect(picked.map((c) => c.id)).toEqual(['a1', 'none1', 'b1']);
  });

  it('tops up from the best of the rest when asked for more than there are topics', () => {
    const cand = (id, score, topicId) => ({ id, score, topicId, metrics: { tested: 1 } });
    const candidates = [
      cand('a1', 95, 'a'),
      cand('a2', 90, 'a'),
      cand('a3', 60, 'a'),
      cand('b1', 50, 'b'),
    ];
    expect(pickClusters(candidates, new Set(), 3).map((c) => c.id)).toEqual(['a1', 'b1']);
    expect(pickClusters(candidates, new Set(), 3, { fill: true }).map((c) => c.id)).toEqual([
      'a1',
      'b1',
      'a2',
    ]);
  });
});

describe('requestScope', () => {
  const candidates = [
    { id: 'c1', topicId: 't1', metrics: { tested: 3 } },
    { id: 'c2', topicId: 't1', metrics: { tested: 2 } },
    { id: 'c3', topicId: 't1', metrics: { tested: 0 } },
    { id: 'c4', topicId: 't2', metrics: { tested: 5 } },
  ];

  it("counts the focus's needs, the covered ones and those with no answers yet", () => {
    expect(
      requestScope(candidates, {
        covered: new Set(['c1', 'c4']),
        inFocus: (c) => c.topicId === 't1',
        requested: 3,
        focus: 'topic',
      }),
    ).toEqual({ focus: 'topic', requested: 3, needs: 3, covered: 1, noAnswers: 1 });
  });

  it('counts a covered need without answers as covered only', () => {
    expect(
      requestScope(candidates, {
        covered: new Set(['c3']),
        inFocus: () => true,
        requested: 2,
        focus: 'auto',
      }),
    ).toMatchObject({ needs: 4, covered: 1, noAnswers: 0 });
  });

  it('is what the generator reports with each request', () => {
    const code = source('./opportunity-generator.js');
    expect(code).toContain('requestScope(candidates');
    expect(code.match(/\.\.\.scope,/g)).toHaveLength(2);
    expect(code).toContain('limited: true, ...scope');
  });
});

describe('generators', () => {
  it('the Generate button runs the shared per-cluster generator', () => {
    const code = source('../workers/content-worker.js');
    expect(code).toContain('generateContentOpportunities(');
    expect(code).toContain('refreshPromptClusters(');
    // It adds to the list instead of replacing it (#63).
    expect(code).not.toMatch(/\.delete\(\)/);
  });

  it("states no volume to the model: the page shows the question's estimate with its source", () => {
    expect(source('./opportunity-generator.js')).not.toMatch(/AI volume: \$\{/);
    expect(source('./opportunity-generator.js')).toContain('questionVolume:');
    expect(source('../routes/content.js')).not.toMatch(/Est\. AI Volume: \$\{/);
  });

  it('runs at most the shared count per run', () => {
    expect(OPPORTUNITIES_PER_RUN).toBe(3);
    expect(source('./opportunity-generator.js')).toContain('pickClusters(');
  });
});
