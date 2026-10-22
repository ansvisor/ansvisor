import { describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * get_prompt_volumes (PROMPT-013): each prompt's estimated AI volume comes
 * with its likely range, how sure it is and that it is an estimate, worked out
 * as the dashboard does.
 */

let rows: Record<string, unknown>[] = [];

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: table === 'brands' ? { id: 'b1' } : null, error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { getPromptVolumesFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

const row = (over: Record<string, unknown>) => ({
  prompt_id: 'p1',
  intent: 'commercial',
  keywords: ['a', 'b', 'c'],
  google_volumes: { a: 1000, b: 1200, c: 1500 },
  total_google_volume: 1200,
  est_ai_volume: 540,
  ai_volume_multiplier: 0.45,
  competition_index: 40,
  competition: 'MEDIUM',
  fetched_at: new Date().toISOString(),
  prompts: { text: 'Best espresso grinder?' },
  ...over,
});

describe('getPromptVolumesFor', () => {
  it('adds the range, confidence and type to each prompt', async () => {
    rows = [
      row({}),
      row({
        prompt_id: 'p2',
        keywords: ['x'],
        google_volumes: { x: 2000 },
        total_google_volume: 2000,
        est_ai_volume: 900,
      }),
    ];
    const volumes = await getPromptVolumesFor(auth, { brandId: 'b1' });
    expect(
      volumes!.map((v) => [
        v.prompt_id,
        v.est_ai_volume,
        v.est_ai_volume_low,
        v.est_ai_volume_high,
        v.volume_confidence,
        v.volume_type,
      ]),
    ).toEqual([
      // Three agreeing keywords: high, ±25%.
      ['p1', 540, 400, 680, 'high', 'estimate'],
      // One keyword: low, half to twice.
      ['p2', 900, 450, 1800, 'low', 'estimate'],
    ]);
  });

  it('counts one level less once the volumes are over six months old', async () => {
    rows = [row({ fetched_at: '2025-01-01T00:00:00Z' })];
    const [volume] = (await getPromptVolumesFor(auth, { brandId: 'b1' }))!;
    expect(volume.volume_confidence).toBe('medium');
  });
});
