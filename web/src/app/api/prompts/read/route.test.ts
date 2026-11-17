import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/prompts/read: Tracked Prompts' table read and its volumes read,
 * by name, run with the member's session; a route so the table's read runs
 * alongside the page's server actions instead of behind them.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
let user: { id: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));
const reads = vi.hoisted(() => ({
  getPromptsPageData: vi.fn(),
  getPromptVolumes: vi.fn(),
  getVolumeAnalysisStatus: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => ({ getPromptsPageData: reads.getPromptsPageData }));
vi.mock('@/lib/actions/volumes', () => ({
  getPromptVolumes: reads.getPromptVolumes,
  getVolumeAnalysisStatus: reads.getVolumeAnalysisStatus,
}));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/prompts/read', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  user = { id: 'u1' };
});

describe('POST /api/prompts/read', () => {
  it("runs the table's read with the page's options, a left-out one as undefined", async () => {
    reads.getPromptsPageData.mockResolvedValue({ promptSets: [] });
    const res = await post({
      read: 'pageData',
      args: [
        BRAND,
        { days: 1, from: null, region: 'US', first: true, withoutAnswers: false, volumes: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { promptSets: [] } });
    expect(reads.getPromptsPageData).toHaveBeenCalledWith(BRAND, {
      days: 1,
      from: undefined,
      to: undefined,
      region: 'US',
      first: true,
      withoutAnswers: false,
      volumes: false,
    });
  });

  it("reads the volumes with the analysis's status, beside each other", async () => {
    reads.getPromptVolumes.mockResolvedValue({ volumes: [], quota: null });
    reads.getVolumeAnalysisStatus.mockResolvedValue({
      running: true,
      total: 3,
      analyzed: 1,
      done: 1,
    });
    const res = await post({ read: 'volumes', args: [BRAND] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { volumes: [], quota: null, status: { running: true, total: 3, analyzed: 1, done: 1 } },
    });
    expect(reads.getPromptVolumes).toHaveBeenCalledWith(BRAND);
    expect(reads.getVolumeAnalysisStatus).toHaveBeenCalledWith(BRAND);
  });

  it("keeps the volumes when the status can't be read, and fails when the volumes can't", async () => {
    reads.getPromptVolumes.mockResolvedValue({ volumes: [], quota: null });
    reads.getVolumeAnalysisStatus.mockRejectedValue(new Error('timeout'));
    const res = await post({ read: 'volumes', args: [BRAND] });
    expect(await res.json()).toEqual({ data: { volumes: [], quota: null, status: null } });

    reads.getPromptVolumes.mockRejectedValue(new Error('Server error: 429'));
    expect((await post({ read: 'volumes', args: [BRAND] })).status).toBe(500);
  });

  it('refuses a signed-out caller, and reads nothing', async () => {
    user = null;
    const res = await post({ read: 'pageData', args: [BRAND] });
    expect(res.status).toBe(401);
    expect(reads.getPromptsPageData).not.toHaveBeenCalled();
  });

  it('refuses an unknown read, a bad brand id or an unknown option', async () => {
    for (const body of [
      { read: 'prompts', args: [BRAND] },
      { read: 'pageData', args: ['not-a-brand'] },
      { read: 'pageData', args: [BRAND, { limit: 5 }] },
      { read: 'volumes', args: [BRAND, 'extra'] },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(reads.getPromptsPageData).not.toHaveBeenCalled();
    expect(reads.getPromptVolumes).not.toHaveBeenCalled();
  });

  it("answers 500 without the error's details when the read fails", async () => {
    reads.getPromptsPageData.mockRejectedValue(new Error('statement timeout'));
    const res = await post({ read: 'pageData', args: [BRAND] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load' });
  });
});
