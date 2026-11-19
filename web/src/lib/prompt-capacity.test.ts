// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * When the plan's prompt locations shrink, the newest tracked prompts past
 * the new limit wait for a spot (00535; owner decision 5, 2026-11-18).
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { promptsToWait, waitOverCapacity } = await import('./prompt-capacity');

describe('promptsToWait', () => {
  const p = (id: string, regions: string[] | null = null) => ({ id, regions });

  it('takes the newest first until the rest fit, counting each location', () => {
    // Newest first: c (3 locations), b (1), a (2) = 6 tracked.
    const tracked = [p('c', ['US', 'GB', 'DE']), p('b'), p('a', ['US', 'TR'])];
    expect(promptsToWait(tracked, 6)).toEqual([]);
    expect(promptsToWait(tracked, 5)).toEqual(['c']);
    expect(promptsToWait(tracked, 3)).toEqual(['c']);
    expect(promptsToWait(tracked, 2)).toEqual(['c', 'b']);
    expect(promptsToWait(tracked, 0)).toEqual(['c', 'b', 'a']);
  });

  it('never trims an unlimited plan', () => {
    expect(promptsToWait([p('a'), p('b')], -1)).toEqual([]);
  });
});

describe('waitOverCapacity', () => {
  const ORG = 'org1';
  const NOW = new Date('2026-11-19T09:00:00Z');
  const prompt = (
    id: string,
    set: string,
    created: string,
    active = true,
    regions: string[] | null = null,
  ) => ({
    id,
    prompt_set_id: set,
    created_at: created,
    is_active: active,
    waiting_since: null,
    regions,
  });

  beforeEach(() => {
    db.failures = {};
    db.tables = {
      brands: [
        { id: 'b1', organization_id: ORG, is_demo: false },
        { id: 'demo', organization_id: ORG, is_demo: true },
        { id: 'other', organization_id: 'org2', is_demo: false },
      ],
      prompt_sets: [
        { id: 's1', brand_id: 'b1' },
        { id: 'sdemo', brand_id: 'demo' },
        { id: 's2', brand_id: 'other' },
      ],
      prompts: [
        prompt('old', 's1', '2026-10-01T00:00:00Z', true, ['US', 'GB']),
        prompt('mid', 's1', '2026-11-01T00:00:00Z'),
        prompt('new', 's1', '2026-11-10T00:00:00Z'),
        prompt('paused', 's1', '2026-11-15T00:00:00Z', false),
        // The demo brand and another organization never count.
        prompt('demo', 'sdemo', '2026-11-18T00:00:00Z'),
        prompt('theirs', 's2', '2026-11-18T00:00:00Z'),
      ],
    };
  });

  const row = (id: string) => db.tables.prompts.find((r) => r.id === id)!;

  it('makes the newest tracked prompts wait until the rest fit', async () => {
    // 4 locations tracked (old 2, mid 1, new 1); the limit drops to 2.
    await expect(waitOverCapacity(ORG, 2, NOW)).resolves.toBe(2);
    expect(row('new')).toMatchObject({ is_active: false, waiting_since: NOW.toISOString() });
    expect(row('mid')).toMatchObject({ is_active: false, waiting_since: NOW.toISOString() });
    expect(row('old')).toMatchObject({ is_active: true, waiting_since: null });
    // A paused prompt stays paused, not waiting; others' prompts are untouched.
    expect(row('paused')).toMatchObject({ is_active: false, waiting_since: null });
    expect(row('demo').is_active).toBe(true);
    expect(row('theirs').is_active).toBe(true);
  });

  it('changes nothing within the limit, or on an unlimited plan', async () => {
    await expect(waitOverCapacity(ORG, 4, NOW)).resolves.toBe(0);
    await expect(waitOverCapacity(ORG, -1, NOW)).resolves.toBe(0);
    expect(db.tables.prompts.filter((r) => r.waiting_since)).toEqual([]);
  });

  it('throws on a failed read, for the caller to log', async () => {
    db.failures = { prompts: { message: 'down' } };
    await expect(waitOverCapacity(ORG, 2, NOW)).rejects.toThrow('down');
  });
});
