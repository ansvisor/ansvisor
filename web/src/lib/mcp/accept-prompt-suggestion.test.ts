// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * accept_prompt_suggestion on a brand with no topic yet: prompts are grouped
 * under topics, so the tool says to add one first (a topic suggestion it can
 * accept itself) and adds nothing. With a topic it adds the prompt as before.
 */

/** The brand's topic, or none. */
let topic: { id: string } | null = null;
/** Rows inserted, by table. */
let inserts: string[] = [];
/** The prompts rows inserted. */
let promptRows: Record<string, unknown>[] = [];
/** The suggestion's catalog source (AC plan P-8), or none. */
let catalogData: Record<string, unknown> | null = null;
/** A ChatGPT Business Hub suggestion's discovery topic (00527), or none. */
let hubTopic: string | null = null;
/** Topics deleted. */
let deletes: string[] = [];
/** Active prompt locations per brand of the organization, as org_prompt_location_usage counts them. */
let usage: { brand_id: string; locations: number }[] = [{ brand_id: 'b1', locations: 0 }];

vi.mock('@/lib/guards/plan-guard', () => ({
  ORG_PLAN_COLUMNS: 'plan',
  planFromOrgRow: () => PLANS.growth,
  usagePlanFromOrgRow: () => PLANS.growth,
}));
const FULL = PLANS.growth.limits.maxPrompts;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: usage, error: null }),
    from: (table: string) => {
      let inserting = false;
      let deleting = false;
      // A topic asked for by name: the Business Hub suggestion's has none yet.
      let byName = false;
      const row = () => {
        if (inserting) {
          if (table === 'topics') return { id: 'made-topic' };
          return table === 'prompts' ? { id: 'p1', text: 'Best GEO tools?' } : null;
        }
        switch (table) {
          case 'prompt_suggestions':
            return {
              id: 's1',
              brand_id: 'b1',
              suggested_text: 'Best GEO tools?',
              topic_name: hubTopic,
              source: hubTopic ? 'business_hub' : catalogData ? 'catalog' : 'llm',
              source_data: hubTopic
                ? { topic: hubTopic, periodEnd: null, enteredAt: '2026-11-09T08:00:00Z' }
                : catalogData,
              generated_at: '2026-11-09T08:00:00+00:00',
            };
          case 'brands':
            return { id: 'b1', organization_id: 'org-1', region: 'US', state: null };
          case 'topics':
            return byName && hubTopic ? null : topic;
          case 'prompt_sets':
            return { id: 'ps1' };
          case 'organizations':
            return { plan: 'growth' };
          default:
            return null;
        }
      };
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (column === 'name') byName = true;
          if (deleting) deletes.push(value);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        delete: () => {
          deleting = true;
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          inserting = true;
          inserts.push(table);
          if (table === 'prompts') promptRows.push(row);
          return chain;
        },
        maybeSingle: async () => ({ data: row(), error: null }),
        single: async () => ({ data: row(), error: null }),
      };
      return chain;
    },
  },
}));

const { acceptPromptSuggestionFor, MCP_NO_TOPICS_MESSAGE } = await import('./data');

afterEach(() => vi.unstubAllEnvs());

const auth = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'admin' as const,
  apiKeyId: 'key-1',
  brandAccess: 'all' as const,
};

beforeEach(() => {
  vi.unstubAllEnvs();
  usage = [{ brand_id: 'b1', locations: 0 }];
  topic = null;
  inserts = [];
  promptRows = [];
  catalogData = null;
  hubTopic = null;
  deletes = [];
});

describe('acceptPromptSuggestionFor', () => {
  it('asks for a topic first on a brand without one, and adds nothing', async () => {
    expect(await acceptPromptSuggestionFor(auth, 's1')).toEqual({
      error: MCP_NO_TOPICS_MESSAGE,
      code: 'no_topics',
    });
    expect(MCP_NO_TOPICS_MESSAGE).toMatch(/accept_topic_suggestion/);
    expect(inserts).toEqual([]);
  });

  it('adds the prompt once the brand has a topic', async () => {
    topic = { id: 't1' };
    expect(await acceptPromptSuggestionFor(auth, 's1')).toMatchObject({
      prompt_id: 'p1',
      status: 'added',
    });
    expect(inserts).toEqual(['prompts']);
  });

  it('keeps the category a catalog suggestion came from with its prompt (00525)', async () => {
    topic = { id: 't1' };
    catalogData = {
      category: 'Bags > Hiking backpacks',
      categoryId: '7a1c2b9e-2222-4c3d-8e9f-000000000002',
      products: 18,
      priceLow: null,
      priceHigh: null,
      priceUnder: null,
      currency: null,
    };
    await acceptPromptSuggestionFor(auth, 's1');
    expect(promptRows[0]).toMatchObject({
      source_data: {
        kind: 'catalog_category',
        category_id: '7a1c2b9e-2222-4c3d-8e9f-000000000002',
        category: 'Bags > Hiking backpacks',
        suggested_at: '2026-11-09T08:00:00+00:00',
      },
    });
  });

  it('makes the topic a ChatGPT Business Hub suggestion names, and files the prompt under it', async () => {
    topic = { id: 't1' };
    hubTopic = 'Decaf beans';
    expect(await acceptPromptSuggestionFor(auth, 's1')).toMatchObject({ status: 'added' });
    expect(inserts).toEqual(['topics', 'prompts']);
    expect(promptRows[0]).toMatchObject({ category: 'Decaf beans', topic_id: 'made-topic' });
    expect('source_data' in promptRows[0]).toBe(false);
    expect(deletes).toEqual([]);
  });

  it('names no source for any other suggestion', async () => {
    topic = { id: 't1' };
    await acceptPromptSuggestionFor(auth, 's1');
    expect('source_data' in promptRows[0]).toBe(false);
  });
});

describe('acceptPromptSuggestionFor with the plan full (Simplify PR 15)', () => {
  beforeEach(() => {
    topic = { id: 't1' };
    // The organization's other brand holds every location: the limit is the organization's.
    usage = [
      { brand_id: 'b1', locations: 0 },
      { brand_id: 'b2', locations: FULL },
    ];
  });

  it('refuses it without SIMPLE_NAV, and adds nothing', async () => {
    expect(await acceptPromptSuggestionFor(auth, 's1')).toMatchObject({ code: 'plan_limit' });
    expect(inserts).toEqual([]);
  });

  it('with SIMPLE_NAV, saves the prompt waiting for a spot and says so', async () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    expect(await acceptPromptSuggestionFor(auth, 's1')).toMatchObject({
      prompt_id: 'p1',
      status: 'added',
      waiting_for_spot: true,
    });
    expect(promptRows[0]).toMatchObject({ is_active: false, waiting_since: expect.any(String) });
  });

  it('tracks it as before while there is room', async () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    usage = [{ brand_id: 'b2', locations: FULL - 1 }];
    const result = await acceptPromptSuggestionFor(auth, 's1');
    expect(result).not.toHaveProperty('waiting_for_spot');
    expect(promptRows[0]).toMatchObject({ is_active: true });
  });
});
