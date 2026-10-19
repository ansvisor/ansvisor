import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, type Plan } from '@/config/plans';
import { getPromptVolumes, type VolumeQuota } from '@/lib/actions/volumes';
import { getPromptVisibilitySummaries } from '@/lib/actions/tracking';

/**
 * setPromptActive meters resuming like adding (00128): only active prompts
 * count toward the plan, so a paused prompt's locations come back when it is
 * resumed. A refusal comes back as a value and nothing is written; pausing is
 * always allowed. Location edits on a paused prompt aren't metered until then.
 */

let promptRow: { regions: string[]; is_active: boolean } | null;
let usedLocations = 0;
let usageFails = false;
let plan: Plan;
let writes: unknown[] = [];
let promptSetRows: Record<string, unknown>[] = [];
let positionData: Record<string, unknown>[] = [];
let positionsError: string | null = null;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getPromptVisibilitySummaries: vi.fn() }));

vi.mock('@/lib/guards/plan-guard', () => ({
  getOrgPlan: vi.fn(async () => plan),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async (fn: string) => {
      if (fn === 'prompt_position_summaries') {
        return positionsError
          ? { data: null, error: { message: positionsError } }
          : { data: positionData, error: null };
      }
      return usageFails
        ? { data: null, error: { message: 'rpc failed' } }
        : { data: [{ brand_id: 'b1', locations: usedLocations }], error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () =>
            table === 'prompt_sets'
              ? { data: promptSetRows, error: null }
              : { data: null, error: { message: `unexpected ${table}` } },
          maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
          single: async () =>
            promptRow
              ? {
                  data: { ...promptRow, prompt_sets: { brands: { organization_id: 'org-1' } } },
                  error: null,
                }
              : { data: null, error: { message: 'no rows' } },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        writes.push(payload);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: { id: 'p1', ...promptRow, ...payload },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
  })),
}));

const { getPromptsPageData, setPromptActive, updatePromptLocations } = await import('./prompt');

const capped = (maxPrompts: number): Plan => ({
  ...PLANS.starter,
  limits: { ...PLANS.starter.limits, maxPrompts },
});

describe('setPromptActive', () => {
  beforeEach(() => {
    writes = [];
    usageFails = false;
    plan = capped(50);
  });

  it('refuses to resume a prompt whose locations no longer fit, and writes nothing', async () => {
    // Paused 3-location prompt, and its room was filled while it was paused.
    promptRow = { regions: ['US', 'DE', 'TR'], is_active: false };
    usedLocations = 49;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ code: 'plan_limit' });
    expect('error' in result && result.error).toContain('49 in place + 3 added');
    expect(writes).toEqual([]);
  });

  it('resumes when the plan has room for every location', async () => {
    promptRow = { regions: ['US', 'DE', 'TR'], is_active: false };
    usedLocations = 47;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ prompt: { id: 'p1', isActive: true } });
    expect(writes).toEqual([{ is_active: true }]);
  });

  it('always lets a prompt be paused, even over the limit', async () => {
    promptRow = { regions: ['US'], is_active: true };
    usedLocations = 60;

    const result = await setPromptActive('p1', false);

    expect(result).toMatchObject({ prompt: { isActive: false } });
    expect(writes).toEqual([{ is_active: false }]);
  });

  it('lets a prompt that is already active be "resumed" at the limit', async () => {
    promptRow = { regions: ['US'], is_active: true };
    usedLocations = 50;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ prompt: { isActive: true } });
  });

  it('never limits unlimited plans', async () => {
    plan = capped(-1);
    promptRow = { regions: ['US', 'DE'], is_active: false };
    usedLocations = 5000;

    const result = await setPromptActive('p1', true);

    expect(result).toMatchObject({ prompt: { isActive: true } });
  });

  it('returns an error and writes nothing for a prompt it cannot see', async () => {
    promptRow = null;

    const result = await setPromptActive('p1', true);

    expect(result).toEqual({ error: 'Prompt not found' });
    expect(writes).toEqual([]);
  });

  it('returns a failed limit check as a value instead of throwing', async () => {
    promptRow = { regions: ['US'], is_active: false };
    usageFails = true;

    const result = await setPromptActive('p1', true);

    expect(result).toEqual({ error: "Couldn't check your plan's prompt limit. Please try again." });
    expect(writes).toEqual([]);
  });
});

describe('updatePromptLocations on paused prompts', () => {
  beforeEach(() => {
    writes = [];
    usageFails = false;
    plan = capped(50);
    usedLocations = 50;
  });

  it('lets a paused prompt gain locations at the limit; they count when it is resumed', async () => {
    promptRow = { regions: ['US'], is_active: false };

    const result = await updatePromptLocations('p1', ['US', 'DE', 'TR']);

    expect(result).toMatchObject({ prompt: { regions: ['US', 'DE', 'TR'] } });
    expect(writes).toEqual([{ regions: ['US', 'DE', 'TR'] }]);
  });

  it('still meters an active prompt gaining locations', async () => {
    promptRow = { regions: ['US'], is_active: true };

    const result = await updatePromptLocations('p1', ['US', 'DE']);

    expect(result).toMatchObject({ code: 'plan_limit' });
    expect(writes).toEqual([]);
  });
});

describe('getPromptsPageData', () => {
  beforeEach(() => {
    plan = capped(50);
    promptRow = null;
    promptSetRows = [
      {
        id: 'ps1',
        brand_id: 'b1',
        name: 'Prompts',
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        prompts: [
          {
            id: 'p1',
            prompt_set_id: 'ps1',
            text: 'best crm for startups',
            platforms: ['chatgpt-web'],
            regions: ['US'],
            models: [],
            is_active: true,
            prompt_target_urls: [],
            created_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    ];
    positionData = [
      {
        prompt_id: 'p1',
        platform: 'chatgpt-web',
        runs: 4,
        mention_answers: 4,
        position_sum: 8,
        position_count: 4,
        entity_sum: 20,
        entity_count: 4,
      },
    ];
    positionsError = null;
    vi.mocked(getPromptVolumes).mockResolvedValue({ volumes: [], quota: {} as VolumeQuota });
    vi.mocked(getPromptVisibilitySummaries).mockResolvedValue({});
    // The location quota fails here (no brand row), which the page also absorbs.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fills the Positions column from the position summaries', async () => {
    const page = await getPromptsPageData('b1');

    expect(page.positions.p1.avg).toBe(2);
    expect(page.positions.p1.dots.map((d) => d.id)).toEqual(['chatgpt-web']);
  });

  it('shows — in the Positions column when the position query fails, instead of failing the page', async () => {
    positionsError = 'canceling statement due to statement timeout';

    const page = await getPromptsPageData('b1');

    expect(page.promptSets[0].prompts.map((p) => p.id)).toEqual(['p1']);
    expect(page.positions.p1).toEqual({ avg: null, delta: null, dots: [], performance: null });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('position summaries'),
      expect.any(Error),
    );
  });
});
