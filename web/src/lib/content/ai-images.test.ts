// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Images made in the Content Editor (CHAT-25 §9, W4-09): the prompt keeps
 * the editor's rules, and a request is held on the draft, made at 1K,
 * charged at what the provider said, stored as options and handed back by
 * address to pick from.
 */

const fakes = vi.hoisted(() => ({
  key: null as unknown,
  reserve: vi.fn(),
  charge: vi.fn(),
  release: vi.fn(),
  generate: vi.fn(),
  store: vi.fn(),
  order: [] as string[],
  // Image models whose maker an Admin turned off (W4-34), or the read's error.
  off: [] as string[],
  offError: null as Error | null,
}));

vi.mock('@/lib/chat/images/access', () => ({
  imageKey: vi.fn(async () => {
    if (fakes.key instanceof Error) throw fakes.key;
    return fakes.key;
  }),
  imageModelOn: vi.fn(async (_org: string, model: string) => {
    if (fakes.offError) throw fakes.offError;
    return !fakes.off.includes(model);
  }),
}));
vi.mock('@/lib/chat/budget', () => ({ reserveDraftImages: fakes.reserve }));
vi.mock('@/lib/chat/images/provider', () => ({ generateImages: fakes.generate }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('./ai-image-store', () => ({ storeAiImageOptions: fakes.store }));
const storage = vi.hoisted(() => ({
  fits: vi.fn<(org: string, bytes: number) => Promise<boolean>>(async () => true),
}));
vi.mock('./image-storage', () => ({
  AI_IMAGE_BYTES: 2 * 1024 * 1024,
  imageStorageFits: storage.fits,
}));

const { DRAFT_IMAGE_RULES, draftImagePrompt, draftImagesInput, makeDraftImages } =
  await import('./ai-images');
const { OwnKeyUnreadableError } = await import('@/lib/chat/key');

const LITE = 'google/gemini-3.1-flash-lite-image';
const GPT = 'openai/gpt-5-image-mini';
const input = draftImagesInput.parse({
  prompt: 'A cover image for “GEO strategies for 2026”',
  model: LITE,
});
const job = { organizationId: 'org-1', draftId: 'draft-1', brandName: 'Acme Coffee', input };

const OPTION_A = { id: 'a.jpg', url: 'https://cdn.example/content-images/org-1/ai-options/a.jpg' };
const OPTION_B = { id: 'b.jpg', url: 'https://cdn.example/content-images/org-1/ai-options/b.jpg' };

beforeEach(() => {
  fakes.key = { key: 'or-ansvisor', source: 'ansvisor' };
  fakes.order = [];
  fakes.off = [];
  fakes.offError = null;
  fakes.charge.mockReset().mockImplementation(async () => {
    fakes.order.push('charge');
  });
  fakes.store.mockReset().mockImplementation(async () => {
    fakes.order.push('store');
    return { stored: [OPTION_A, OPTION_B], failed: 0 };
  });
  fakes.release.mockReset().mockResolvedValue(undefined);
  fakes.reserve.mockReset().mockResolvedValue({
    ok: true,
    budget: { charge: fakes.charge, release: fakes.release, keep: vi.fn() },
  });
  fakes.generate.mockReset().mockResolvedValue({
    images: [
      { base64: 'AAA=', mimeType: 'image/jpeg' },
      { base64: 'BBB=', mimeType: 'image/jpeg' },
    ],
    costUsd: 0.0672,
    refusals: [],
  });
});

describe('the prompt', () => {
  it('keeps the person’s words, the style, and the rules: no product screens, realistic people or charts with numbers, no text', () => {
    expect(draftImagePrompt({ prompt: 'A coffee cup', style: 'brand' }, 'Acme Coffee')).toBe(
      `A coffee cup\n\nStyle: clean, modern and warm, in colors that suit Acme Coffee.\n\n${DRAFT_IMAGE_RULES}`,
    );
    expect(draftImagePrompt({ prompt: 'x y z', style: 'illustration' }, '')).toContain(
      'flat illustration',
    );
    expect(draftImagePrompt({ prompt: 'x y z', style: 'photo' }, '')).toContain('no people');
    expect(DRAFT_IMAGE_RULES).toMatch(/never a web page, app screen/);
    expect(DRAFT_IMAGE_RULES).toMatch(/no realistic people/);
    expect(DRAFT_IMAGE_RULES).toMatch(/no charts, graphs or numbers/);
    expect(DRAFT_IMAGE_RULES).toMatch(/no words, letters, labels or logos/);
  });

  it('takes two to four options, a known model, style and shape', () => {
    expect(input).toMatchObject({ style: 'brand', aspectRatio: '16:9', count: 2 });
    for (const bad of [
      { prompt: 'ok go', model: LITE, count: 1 },
      { prompt: 'ok go', model: LITE, count: 5 },
      { prompt: 'ok go', model: 'acme/unknown' },
      { prompt: 'no', model: LITE },
      { prompt: 'ok go', model: LITE, aspectRatio: '21:9' },
    ]) {
      expect(draftImagesInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('a request for a draft', () => {
  it('holds the images on the draft, makes them at 1K, charges what the provider said, and hands them back by address', async () => {
    const made = await makeDraftImages(job);
    expect(fakes.reserve).toHaveBeenCalledWith({
      organizationId: 'org-1',
      draftId: 'draft-1',
      model: LITE,
      images: 2,
      source: 'ansvisor',
    });
    expect(fakes.generate).toHaveBeenCalledWith({
      model: LITE,
      prompt: draftImagePrompt(input, 'Acme Coffee'),
      count: 2,
      size: '1K',
      key: 'or-ansvisor',
      aspectRatio: '16:9',
    });
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 2, costUsd: 0.0672 });
    // Charged once, before anything is stored.
    expect(fakes.order).toEqual(['charge', 'store']);
    expect(fakes.store).toHaveBeenCalledWith('org-1', [
      { base64: 'AAA=', mimeType: 'image/jpeg' },
      { base64: 'BBB=', mimeType: 'image/jpeg' },
    ]);
    expect(made).toEqual({ ok: true, images: [OPTION_A, OPTION_B], failed: 0 });
  });

  it('answers with addresses only: four 1K images make a small body, with no image bytes', async () => {
    // About 1.5 MB each, as a 1K image is: four of them as base64 would pass the host's 4.5 MB.
    const big = Buffer.alloc(1_500_000, 7).toString('base64');
    fakes.generate.mockResolvedValue({
      images: Array.from({ length: 4 }, () => ({ base64: big, mimeType: 'image/jpeg' })),
      costUsd: 0.13,
      refusals: [],
    });
    fakes.store.mockResolvedValue({ stored: [OPTION_A, OPTION_B, OPTION_A, OPTION_B], failed: 0 });
    const body = JSON.stringify(await makeDraftImages({ ...job, input: { ...input, count: 4 } }));
    expect(body.length).toBeLessThan(2_000);
    expect(body).not.toContain('base64');
    expect(body).not.toContain('data:');
    expect(body).not.toContain(big.slice(0, 64));
  });

  it('keeps the charge when some can’t be stored, and says how many', async () => {
    fakes.store.mockResolvedValue({ stored: [OPTION_B], failed: 1 });
    expect(await makeDraftImages(job)).toEqual({ ok: true, images: [OPTION_B], failed: 1 });
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 2, costUsd: 0.0672 });
    expect(fakes.release).not.toHaveBeenCalled();
  });

  it('says the images were made and charged when none could be stored', async () => {
    fakes.store.mockResolvedValue({ stored: [], failed: 2 });
    expect(await makeDraftImages(job)).toEqual({ ok: false, code: 'not_saved', made: 2 });
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 2, costUsd: 0.0672 });
    expect(fakes.release).not.toHaveBeenCalled();
  });

  it('says why the model made none, charging only what it said', async () => {
    fakes.generate.mockResolvedValue({ images: [], costUsd: 0, refusals: ['Blocked\nby safety'] });
    expect(await makeDraftImages(job)).toEqual({
      ok: false,
      code: 'refused',
      why: 'Blocked by safety',
    });
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 0, costUsd: 0 });
    expect(fakes.store).not.toHaveBeenCalled();
  });

  it('makes nothing past the AI limit, without a key, or on an own key it can’t read', async () => {
    fakes.reserve.mockResolvedValue({ ok: false, refusal: 'ai_limit', trial: true });
    expect(await makeDraftImages(job)).toEqual({ ok: false, code: 'ai_limit', trial: true });
    fakes.key = null;
    expect(await makeDraftImages(job)).toEqual({ ok: false, code: 'unavailable' });
    fakes.key = new OwnKeyUnreadableError('openrouter');
    expect(await makeDraftImages(job)).toEqual({ ok: false, code: 'own_key' });
    expect(fakes.generate).not.toHaveBeenCalled();
  });

  it('makes nothing the workspace’s storage has no room for, holding and charging nothing (00490)', async () => {
    storage.fits.mockResolvedValueOnce(false);
    expect(await makeDraftImages(job)).toEqual({ ok: false, code: 'storage_full' });
    expect(storage.fits).toHaveBeenCalledWith(
      job.organizationId,
      job.input.count * 2 * 1024 * 1024,
    );
    expect(fakes.reserve).not.toHaveBeenCalled();
    expect(fakes.generate).not.toHaveBeenCalled();
    expect(fakes.store).not.toHaveBeenCalled();
  });

  it('refuses a model whose maker an Admin turned off, holding, charging and sending nothing (W4-34)', async () => {
    fakes.off = [LITE];
    expect(await makeDraftImages(job)).toEqual({
      ok: false,
      code: 'provider_off',
      model: 'Nano Banana 2 Lite',
    });
    // Its maker's setting can't be read: refused too, as Chat refuses it.
    fakes.off = [];
    fakes.offError = new Error('read failed');
    expect(await makeDraftImages(job)).toMatchObject({ ok: false, code: 'provider_off' });
    expect(fakes.reserve).not.toHaveBeenCalled();
    expect(fakes.charge).not.toHaveBeenCalled();
    expect(fakes.generate).not.toHaveBeenCalled();
    expect(fakes.store).not.toHaveBeenCalled();
  });

  it('still makes images on a model whose maker is on while another maker is off', async () => {
    fakes.off = [LITE];
    const made = await makeDraftImages({ ...job, input: { ...input, model: GPT } });
    expect(made).toEqual({ ok: true, images: [OPTION_A, OPTION_B], failed: 0 });
    expect(fakes.reserve).toHaveBeenCalledWith(expect.objectContaining({ model: GPT }));
    expect(fakes.generate).toHaveBeenCalledWith(expect.objectContaining({ model: GPT }));
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 2, costUsd: 0.0672 });
  });

  it('lets the hold go when the provider call throws', async () => {
    fakes.generate.mockRejectedValue(new Error('aborted'));
    await expect(makeDraftImages(job)).rejects.toThrow('aborted');
    expect(fakes.release).toHaveBeenCalled();
    expect(fakes.charge).not.toHaveBeenCalled();
  });
});
