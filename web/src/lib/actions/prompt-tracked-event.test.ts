import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * The funnel's `prompt_tracked`: one event per save with how many prompts,
 * ids and counts only (never a prompt's text), and a failed capture never
 * fails the save.
 */

const captureForSessionUser = vi.fn();
vi.mock('@/lib/posthog-server', () => ({
  captureForSessionUser: (...args: unknown[]) => captureForSessionUser(...args),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn() }));
vi.mock('@/lib/topics-required', () => ({
  NO_TOPICS: 'no_topics',
  NO_TOPICS_MESSAGE: 'no topics',
  brandHasTopics: async () => true,
}));
vi.mock('@/lib/guards/plan-guard', () => ({
  getOrgPlan: async () => PLANS.growth,
  ORG_PLAN_COLUMNS: 'plan',
  planFromOrgRow: () => PLANS.growth,
}));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getPromptVisibilitySummaries: vi.fn() }));

const answers: Record<string, unknown> = {
  prompt_sets: { brand_id: 'b1', id: 's1' },
  brands: { organization_id: 'o1', region: 'US', state: null, shopping_mode_enabled: false },
  prompts: {
    id: 'p1',
    text: 'secret prompt text',
    prompt_set_id: 's1',
    platforms: ['chatgpt-web'],
  },
  topics: { id: 't1' },
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain: unknown = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then')
              return (resolve: (v: unknown) => void) =>
                resolve({ data: table === 'prompts' ? [] : [answers[table]], error: null });
            if (prop === 'single' || prop === 'maybeSingle')
              return async () => ({ data: answers[table], error: null });
            return () => chain;
          },
        },
      );
      return chain;
    },
    rpc: async () => ({ data: [], error: null }),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}));

const { addPromptToSet } = await import('./prompt');

beforeEach(() => captureForSessionUser.mockReset().mockResolvedValue(undefined));

describe('addPromptToSet and the funnel', () => {
  it('sends prompt_tracked with the brand and a count of one, no text', async () => {
    const result = await addPromptToSet({
      promptSetId: 's1',
      text: 'secret prompt text',
      platforms: ['chatgpt-web'],
    });
    expect('error' in result, JSON.stringify(result)).toBe(false);
    expect(captureForSessionUser).toHaveBeenCalledTimes(1);
    const [, event, properties] = captureForSessionUser.mock.calls[0];
    expect(event).toBe('prompt_tracked');
    expect(properties).toEqual({ brand_id: 'b1', count: 1, source: 'single' });
  });
});
