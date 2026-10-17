import { beforeEach, describe, expect, it, vi } from 'vitest';

let result: { data: unknown; error: { code?: string; message: string } | null };
const rpc = vi.fn(async () => result);
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

import { getMentionsOverview } from './mentions';

beforeEach(() => {
  rpc.mockClear();
  result = { data: null, error: null };
});

describe('getMentionsOverview', () => {
  it('reads the window and filters in one call', async () => {
    result = {
      data: {
        window: { from: 'f', to: 't', days: 7, source: 'days' },
        current: { answers: 8, mentions: 6 },
        previous: null,
        platforms: [],
        daily: [],
        competitors: [],
      },
      error: null,
    };
    const overview = await getMentionsOverview('b1', {
      from: '2026-10-10T00:00:00.000Z',
      platform: 'gemini-web',
      topicId: 't1',
      search: 'pricing',
    });
    expect(rpc).toHaveBeenCalledWith('mentions_overview', {
      p_brand_id: 'b1',
      p_date_from: '2026-10-10T00:00:00.000Z',
      p_date_to: undefined,
      p_platform: 'gemini-web',
      p_region: undefined,
      p_topic_id: 't1',
      p_search: 'pricing',
    });
    expect(overview?.current).toMatchObject({ answers: 8, mentions: 6 });
  });

  it('is null before the migration has run', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(getMentionsOverview('b1', { from: 'f' })).resolves.toBeNull();
  });

  it('is null for a caller outside the organization', async () => {
    await expect(getMentionsOverview('b1', { from: 'f' })).resolves.toBeNull();
  });

  it('throws on any other error', async () => {
    result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(getMentionsOverview('b1', { from: 'f' })).rejects.toThrow('statement timeout');
  });
});
