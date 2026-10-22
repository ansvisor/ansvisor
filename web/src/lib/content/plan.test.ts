import { describe, expect, it } from 'vitest';
import {
  MAX_ROWS,
  buildPlan,
  citationsDownScore,
  protectScore,
  rowsFor,
  type PlanAnswers,
  type PlanDraft,
  type PlanOpportunity,
  type PlanPage,
} from './plan';

/**
 * The Content plan (CE-014): opportunities and the brand's pages as one
 * ranked list of what to create, optimize or protect, without the same page
 * twice, with the drafts already being written.
 */

const page = (path: string, over: Partial<PlanPage> = {}): PlanPage => ({
  page: `https://acme.example${path}`,
  title: path.slice(1),
  citations: { cur: 2, prev: 2 },
  platformsDown: [],
  aiVisits: 0,
  ...over,
});
const opportunity = (id: string, over: Partial<PlanOpportunity> = {}): PlanOpportunity => ({
  id,
  title: `Opportunity ${id}`,
  pageTitle: null,
  decision: 'create',
  score: 70,
  targetPage: null,
  targetTitle: null,
  competitorsCited: [],
  visibility: null,
  prompts: 3,
  ...over,
});
const plan = (
  pages: PlanPage[],
  opportunities: PlanOpportunity[] = [],
  drafts: PlanDraft[] = [],
  answers: PlanAnswers = { cur: 100, prev: 100 },
) => buildPlan({ pages, answers, opportunities, drafts, siteType: 'b2b' });

describe('buildPlan', () => {
  it('creates a new page for an opportunity, named by its brief, with its evidence', () => {
    const { rows, counts } = plan(
      [],
      [
        opportunity('o1', {
          title: 'Create a pricing comparison',
          pageTitle: 'Northwind vs HubSpot',
          competitorsCited: ['HubSpot'],
          visibility: 6,
          score: 81.4,
        }),
      ],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'create',
        title: 'Northwind vs HubSpot',
        page: null,
        pageType: 'comparison',
        why: { kind: 'competitors', names: ['HubSpot'], visibility: 6 },
        source: 'opportunity',
        score: 81,
        opportunityId: 'o1',
        draft: null,
      }),
    ]);
    expect(counts).toEqual({ create: 1, optimize: 0, protect: 0 });
  });

  it('optimizes a page losing citations, by how much it lost, with the platforms citing it less', () => {
    const { rows } = plan([
      page('/features/forecasting', {
        citations: { cur: 6, prev: 10 },
        platformsDown: ['chatgpt-web', 'perplexity-web'],
      }),
      // Down 10%: not losing ground.
      page('/features/email', { citations: { cur: 9, prev: 10 } }),
      // Too few to tell.
      page('/blog/note', { citations: { cur: 0, prev: 2 } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: 'optimize',
      page: 'https://acme.example/features/forecasting',
      why: { kind: 'citationsDown', pct: 40, platforms: ['chatgpt-web', 'perplexity-web'] },
      source: 'citations',
      score: citationsDownScore(40, 4),
    });
    expect(rows[1]).toMatchObject({ action: 'protect', title: 'features/email' });
  });

  it('compares citations per tracked answer, so fewer runs or prompts move no page', () => {
    const pages = [page('/features/forecasting', { citations: { cur: 5, prev: 10 } })];
    // Half the answers this period (a weekly brand before its run, prompts removed).
    expect(plan(pages, [], [], { cur: 50, prev: 100 }).rows[0]).toMatchObject({
      action: 'protect',
    });
    // The same answers: down 50%, 5 citations lost.
    expect(plan(pages).rows[0]).toMatchObject({
      why: { kind: 'citationsDown', pct: 50 },
      score: citationsDownScore(50, 5),
    });
    // Twice the answers and the same citations: down 50% per answer, 15 lost.
    expect(plan(pages, [], [], { cur: 200, prev: 100 }).rows[0]).toMatchObject({
      why: { kind: 'citationsDown', pct: 75 },
      score: citationsDownScore(75, 15),
    });
    // No answers before: nothing to compare with.
    expect(plan(pages, [], [], { cur: 100, prev: 0 }).rows[0]).toMatchObject({
      action: 'protect',
    });
  });

  it('ranks a drop by the citations lost more than by its share', () => {
    expect(citationsDownScore(41, 82)).toBeGreaterThan(citationsDownScore(100, 3));
  });

  it('keeps one row for a page an opportunity targets, with the period’s signal when it is losing', () => {
    const { rows } = plan(
      [page('/guides/espresso/', { citations: { cur: 2, prev: 8 } })],
      [
        opportunity('o1', {
          title: 'Expand the espresso guide',
          decision: 'optimize',
          targetPage: 'https://www.acme.example/guides/espresso',
          targetTitle: 'The home espresso guide',
          score: 50,
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'optimize',
      title: 'The home espresso guide',
      opportunityId: 'o1',
      source: 'citations',
      why: { kind: 'citationsDown', pct: 75 },
      score: citationsDownScore(75, 6),
    });
  });

  it('protects the five most cited pages, after the work to do', () => {
    const pages = [5, 6, 7, 8, 9, 30].map((cur, i) =>
      page(`/p${i}`, { citations: { cur, prev: cur }, aiVisits: 10 }),
    );
    const { rows, counts } = plan(pages, [opportunity('o1', { score: 61 })]);
    expect(counts.protect).toBe(5);
    expect(rows.map((r) => r.title)).toEqual(['Opportunity o1', 'p5', 'p4', 'p3', 'p2', 'p1']);
    expect(rows[1]).toMatchObject({
      why: { kind: 'top', citations: 30, aiVisits: 10 },
      score: protectScore(30),
    });
  });

  it('protects a page an opportunity says to defend', () => {
    const { rows } = plan(
      [],
      [
        opportunity('o1', {
          decision: 'defend',
          targetPage: 'https://acme.example/pricing',
          targetTitle: 'Pricing',
        }),
      ],
    );
    expect(rows[0]).toMatchObject({ action: 'protect', page: 'https://acme.example/pricing' });
  });

  it('leaves a top page past the five protected off the list', () => {
    const pages = [5, 6, 7, 8, 9, 30].map((cur, i) =>
      page(`/p${i}`, { citations: { cur, prev: cur } }),
    );
    const { rows, counts } = plan(pages);
    expect(counts.protect).toBe(5);
    expect(rows.find((r) => r.title === 'p0')).toBeUndefined();
  });

  it('counts every row, and each card lists its own first rows', () => {
    const opportunities = Array.from({ length: 60 }, (_, i) =>
      opportunity(`o${i}`, { score: 99 - (i % 30) }),
    );
    const pages = [
      page('/top', { citations: { cur: 30, prev: 30 } }),
      page('/guides/losing', { citations: { cur: 2, prev: 8 } }),
    ];
    const { rows, counts } = plan(pages, opportunities);
    expect(counts).toEqual({ create: 60, optimize: 1, protect: 1 });
    expect(rowsFor(rows, null)).toHaveLength(MAX_ROWS);
    // Below the 50 opportunities on score, and still shown on their cards.
    expect(rowsFor(rows, 'protect').map((r) => r.title)).toEqual(['top']);
    expect(rowsFor(rows, 'optimize').map((r) => r.title)).toEqual(['guides/losing']);
  });

  it('lists no page only because other pages of the brand are cited for its prompts', () => {
    // A steady page under the top-page bar: nothing to do, whatever else is cited.
    const { rows, counts } = plan([
      page('/blog/espresso-basics'),
      page('/guides/espresso', { citations: { cur: 12, prev: 10 } }),
    ]);
    expect(rows.map((r) => [r.action, r.why.kind])).toEqual([['protect', 'top']]);
    expect(counts).toEqual({ create: 0, optimize: 0, protect: 1 });
  });

  it('finds the draft being written for an opportunity or a page', () => {
    const drafts: PlanDraft[] = [
      {
        id: 'd1',
        author: 'agent',
        isMine: false,
        method: 'create',
        opportunityId: 'o1',
        sourceUrl: null,
      },
      {
        id: 'd2',
        author: 'user',
        isMine: true,
        method: 'optimize',
        opportunityId: null,
        sourceUrl: 'https://acme.example/features/forecasting/',
      },
    ];
    const { rows } = plan(
      [page('/features/forecasting', { citations: { cur: 1, prev: 9 } })],
      [opportunity('o1')],
      drafts,
    );
    // The opportunity (70) ranks over the page losing ground (1 of 9: 66).
    expect(rows.map((r) => r.draft?.id)).toEqual(['d1', 'd2']);
  });
});
