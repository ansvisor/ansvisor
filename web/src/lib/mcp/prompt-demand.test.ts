import { describe, expect, it, vi } from 'vitest';

/**
 * A prompt's real demand (PROMPT-014, 00370) as get_prompt_volumes returns
 * it: each signal read with its day, the questions and the top query alone
 * (not their pages or weekly points), and nothing made up from a signal never
 * read.
 */

const calls: string[][] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => {
          calls.push(ids);
          return { data: ids.map((id) => ({ prompt_id: id, signals: 0 })), error: null };
        },
      }),
    }),
  },
}));

const { promptDemandOf, readPromptDemand } = await import('./prompt-demand');

describe('promptDemandOf', () => {
  it('reads each signal with the day it was read', () => {
    expect(
      promptDemandOf({
        prompt_id: 'p1',
        level: 'medium',
        signals: 4,
        keyword: 'espresso grinder',
        gsc: { impressions: 120, clicks: 3, queries: 2, top: null, at: '2026-10-27' },
        trends: { points: [1, 2], trend: 'steady', change: null, at: '2026-10-21' },
        paa: {
          questions: [
            { question: 'Which grinder is best?', url: 'https://a.example/', domain: 'a.example' },
            { question: 'Is a burr grinder worth it?', url: null, domain: null },
          ],
          at: '2026-10-21',
        },
        youtube: { videos: 18, views: 240000, results: 900, top: null, at: '2026-10-21' },
        updated_at: '2026-10-27',
      }),
    ).toEqual({
      level: 'medium',
      signals_read: 4,
      keyword: 'espresso grinder',
      updated_at: '2026-10-27',
      search_console: {
        impressions: 120,
        clicks: 3,
        queries: 2,
        top_query: null,
        read_at: '2026-10-27',
      },
      google_trends: { trend: 'steady', change_percent: null, read_at: '2026-10-21' },
      people_also_ask: {
        questions: ['Which grinder is best?', 'Is a burr grinder worth it?'],
        read_at: '2026-10-21',
      },
      youtube: { videos: 18, views: 240000, read_at: '2026-10-21' },
    });
  });

  it('leaves a signal never read null, and a level it does not know out', () => {
    const demand = promptDemandOf({
      prompt_id: 'p1',
      level: 'huge',
      signals: 0,
      gsc: null,
      trends: { trend: 'sideways', at: '2026-10-21' },
    });
    expect(demand).toMatchObject({
      level: null,
      signals_read: 0,
      keyword: null,
      search_console: null,
      people_also_ask: null,
      youtube: null,
    });
    expect(demand.google_trends).toEqual({
      trend: null,
      change_percent: null,
      read_at: '2026-10-21',
    });
  });
});

describe('readPromptDemand', () => {
  it('reads the prompts a hundred at a time', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const demand = await readPromptDemand(ids);
    expect(calls.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(demand.size).toBe(250);
  });
});
