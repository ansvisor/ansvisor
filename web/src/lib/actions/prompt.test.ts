import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, type Plan } from '@/config/plans';

/**
 * setPromptActive meters resuming like adding (00128): only active prompts
 * count toward the plan, so a paused prompt's locations come back when it is
 * resumed. A refusal comes back as a value and nothing is written; pausing is
 * always allowed.
 */

let promptRow: { regions: string[]; is_active: boolean };
let usedLocations = 0;
let plan: Plan;
let writes: unknown[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({ getPromptVisibilitySummaries: vi.fn() }));

vi.mock('@/lib/guards/plan-guard', () => ({
  getOrgPlan: vi.fn(async () => plan),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async () => ({
      data: [{ brand_id: 'b1', locations: usedLocations }],
      error: null,
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ...promptRow, prompt_sets: { brands: { organization_id: 'org-1' } } },
            error: null,
          }),
        }),
      }),
      update: (payload: { is_active: boolean }) => {
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

const { setPromptActive } = await import('./prompt');

const capped = (maxPrompts: number): Plan => ({
  ...PLANS.starter,
  limits: { ...PLANS.starter.limits, maxPrompts },
});

describe('setPromptActive', () => {
  beforeEach(() => {
    writes = [];
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
});
