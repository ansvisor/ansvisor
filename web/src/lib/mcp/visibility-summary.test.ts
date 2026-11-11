// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { computeAiVisibilityScore } from '@/lib/visibility-score';

/**
 * The visibility summary (Chat's Visibility and overview reads, the MCP tool,
 * the REST endpoint and the in-product agent): whole UTC days come from the
 * daily rollups the Visibility page reads, in two calls that run together,
 * never from the answers themselves. On a customer brand the raw path outran
 * Chat's 20 s read limit twice in one run (2026-11-11). A window that starts
 * or ends inside a day still reads the raw rows.
 */

type Rpc = { fn: string; args: Record<string, unknown> };

const db = vi.hoisted(() => ({
  tables: [] as string[],
  rpcs: [] as Rpc[],
  payloads: {} as Record<string, unknown>,
  errors: {} as Record<string, { message: string }>,
  /** Holds every function call until released, to see what runs together. */
  gate: null as Promise<void> | null,
}));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    db.tables.push(table);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'neq', 'in', 'gte', 'lte']) chain[name] = () => chain;
    chain.maybeSingle = async () => ({
      data: table === 'brands' ? { id: 'b1', name: 'Acme' } : null,
      error: null,
    });
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
    return chain;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    db.rpcs.push({ fn, args });
    if (db.gate) await db.gate;
    return { data: db.payloads[fn] ?? null, error: db.errors[fn] ?? null };
  };
  return { supabaseAdmin: { from, rpc } };
});

const { getVisibilitySummaryFor } = await import('./data');

const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'analyst',
  apiKeyId: 'key-1',
  brandAccess: 'all',
};

/** A month of a busy brand: far past the 1,000 rows one PostgREST read returns. */
const AGGREGATES = {
  brand_row_count: 54_000,
  brand_sum_visibility: 810_000,
  brand_total_mentions: 21_500,
  brand_total_citations: 6_200,
  brand_prompt_count: 300,
  brand_visible_prompts: 126,
  by_competitor: [
    { competitor_id: 'c1', name: 'Peec AI', sum_visibility: 540_000, total_mentions: 9_000 },
    { competitor_id: 'c2', name: 'Profound', sum_visibility: 1_080_000, total_mentions: 30_000 },
    { competitor_id: 'c3', name: 'Otterly', sum_visibility: null, total_mentions: 0 },
    { competitor_id: 'c4', name: 'Scrunch', sum_visibility: 27_000, total_mentions: 500 },
    { competitor_id: 'c5', name: 'Athena', sum_visibility: 54_000, total_mentions: 1_500 },
    { competitor_id: 'c6', name: 'Rankscale', sum_visibility: 5_400, total_mentions: 100 },
  ],
};
const SCORE = {
  answers: 54_000,
  mention_answers: 16_200,
  citation_answers: 5_400,
  position_factor: 0.5,
  by_competitor: [
    {
      competitor_id: 'c2',
      name: 'Profound',
      mention_answers: 27_000,
      citation_answers: 2_700,
      position_factor: 0.6,
    },
    {
      competitor_id: 'c1',
      name: 'Peec AI',
      mention_answers: 8_100,
      citation_answers: 540,
      position_factor: '0.25',
    },
  ],
};

const fns = () => db.rpcs.map((call) => call.fn);

beforeEach(() => {
  db.tables = [];
  db.rpcs = [];
  db.payloads = {
    competitor_aggregates_daily: AGGREGATES,
    ai_visibility_aggregates_daily: SCORE,
  };
  db.errors = {};
  db.gate = null;
});

describe('getVisibilitySummaryFor over whole days', () => {
  it("reads Chat's default 30 days from the rollups, never the answers", async () => {
    await getVisibilitySummaryFor(AUTH, {
      brandId: 'b1',
      dateFrom: '2026-10-12',
      dateTo: '2026-11-11',
    });
    expect(fns().sort()).toEqual(['ai_visibility_aggregates_daily', 'competitor_aggregates_daily']);
    expect(db.tables).not.toContain('prompt_results');
    const args = {
      p_brand_id: 'b1',
      p_models: null,
      p_region: null,
      p_day_from: '2026-10-12',
      p_day_to: '2026-11-11',
    };
    for (const call of db.rpcs) expect(call.args).toEqual(args);
  });

  it('runs its two calls together', async () => {
    let release!: () => void;
    db.gate = new Promise<void>((resolve) => (release = resolve));
    const summary = getVisibilitySummaryFor(AUTH, {
      brandId: 'b1',
      dateFrom: '2026-10-12',
      dateTo: '2026-11-11',
    });
    await vi.waitFor(() => expect(db.rpcs).toHaveLength(2));
    release();
    await expect(summary).resolves.toMatchObject({ totals: { resultCount: 54_000 } });
  });

  it('gives every answer of the window, the score and the top five competitors', async () => {
    const summary = await getVisibilitySummaryFor(AUTH, {
      brandId: 'b1',
      dateFrom: '2026-10-12T00:00:00Z',
      dateTo: '2026-11-11T23:59:59Z',
    });
    expect(summary).toEqual({
      brand: { id: 'b1', name: 'Acme' },
      totals: {
        resultCount: 54_000,
        avgVisibility: 15,
        totalMentions: 21_500,
        totalCitations: 6_200,
        visiblePrompts: 126,
        promptCount: 300,
        visibilityRatePct: 42,
        aiVisibilityScore: computeAiVisibilityScore({
          answers: 54_000,
          mentionAnswers: 16_200,
          citationAnswers: 5_400,
          positionFactor: 0.5,
        }),
        mentionAnswers: 16_200,
        citationAnswers: 5_400,
        positionFactor: 0.5,
      },
      // By mentions; each average over the brand's answers (#478), each score by competitor id.
      topCompetitors: [
        {
          name: 'Profound',
          mentions: 30_000,
          avgVisibility: 20,
          score: computeAiVisibilityScore({
            answers: 54_000,
            mentionAnswers: 27_000,
            citationAnswers: 2_700,
            positionFactor: 0.6,
          }),
        },
        {
          name: 'Peec AI',
          mentions: 9_000,
          avgVisibility: 10,
          score: computeAiVisibilityScore({
            answers: 54_000,
            mentionAnswers: 8_100,
            citationAnswers: 540,
            positionFactor: 0.25,
          }),
        },
        { name: 'Athena', mentions: 1_500, avgVisibility: 1, score: null },
        { name: 'Scrunch', mentions: 500, avgVisibility: 0.5, score: null },
        { name: 'Rankscale', mentions: 100, avgVisibility: 0.1, score: null },
      ],
    });
  });

  it('reads all time from the rollups too, with the filters asked', async () => {
    await getVisibilitySummaryFor(AUTH, {
      brandId: 'b1',
      model: 'gpt-5-chat-latest, gpt-5-mini',
      region: 'TR',
    });
    expect(db.tables).not.toContain('prompt_results');
    for (const call of db.rpcs) {
      expect(call.args).toEqual({
        p_brand_id: 'b1',
        p_models: ['gpt-5-chat-latest', 'gpt-5-mini'],
        p_region: 'TR',
        p_day_from: null,
        p_day_to: null,
      });
    }
  });

  it('gives zeros and no competitors for a window without answers', async () => {
    db.payloads = {
      competitor_aggregates_daily: {
        brand_row_count: 0,
        brand_sum_visibility: 0,
        brand_total_mentions: 0,
        brand_total_citations: 0,
        brand_prompt_count: 0,
        brand_visible_prompts: 0,
        by_competitor: [],
      },
      ai_visibility_aggregates_daily: {
        answers: 0,
        mention_answers: 0,
        citation_answers: 0,
        position_factor: null,
        by_competitor: [],
      },
    };
    const summary = await getVisibilitySummaryFor(AUTH, { brandId: 'b1', dateFrom: '2026-11-11' });
    expect(summary?.totals).toMatchObject({
      resultCount: 0,
      avgVisibility: 0,
      visibilityRatePct: 0,
      aiVisibilityScore: null,
      positionFactor: null,
    });
    expect(summary?.topCompetitors).toEqual([]);
  });

  it('fails when a rollup read fails, rather than reading as empty', async () => {
    db.errors.ai_visibility_aggregates_daily = { message: 'canceling statement' };
    await expect(
      getVisibilitySummaryFor(AUTH, { brandId: 'b1', dateFrom: '2026-10-12' }),
    ).rejects.toThrow('canceling statement');
  });

  it("reads nothing for a brand outside the person's access", async () => {
    expect(
      await getVisibilitySummaryFor({ ...AUTH, brandAccess: ['b2'] }, { brandId: 'b1' }),
    ).toBeNull();
    expect(db.rpcs).toEqual([]);
  });
});

describe('getVisibilitySummaryFor over a window inside a day', () => {
  it('reads the raw rows', async () => {
    db.payloads = { tracked_prompt_count: 0 };
    await getVisibilitySummaryFor(AUTH, {
      brandId: 'b1',
      dateFrom: '2026-11-10T15:30:00Z',
      dateTo: '2026-11-11T15:30:00Z',
    });
    expect(db.tables).toContain('prompt_results');
    expect(fns().sort()).toEqual([
      'ai_visibility_aggregates',
      'tracked_prompt_count',
      'visible_prompt_stats',
    ]);
    expect(db.rpcs[0].args).toMatchObject({
      p_date_from: '2026-11-10T15:30:00Z',
      p_date_to: '2026-11-11T15:30:00Z',
    });
  });
});
