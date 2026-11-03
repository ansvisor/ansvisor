// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Images in Chat on the server (CHAT-15 §E, W4-08): whose key they run on,
 * the image model question, the parts check's count, and a request held,
 * made, charged at what the provider said and filed as one set.
 */

const fakes = vi.hoisted(() => ({
  agentic: true,
  chatKey: null as unknown,
  ownProvider: null as string | null,
  shares: [] as { model: string; percent: number | null }[],
  fit: vi.fn(),
  reserve: vi.fn(),
  charge: vi.fn(),
  release: vi.fn(),
  generate: vi.fn(),
  file: vi.fn(),
  storage: { usedBytes: 0, limitBytes: null as number | null, fileCount: 0 },
  brandOrg: 'org-1' as string | null,
}));

vi.mock('../flag', () => ({ chatAgenticEnabled: () => fakes.agentic }));
vi.mock('../key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../key')>()),
  resolveChatModelKey: vi.fn(async () => {
    if (fakes.chatKey instanceof Error) throw fakes.chatKey;
    return fakes.chatKey;
  }),
  ownChatKeyProvider: vi.fn(async () => fakes.ownProvider),
}));
vi.mock('../budget', () => ({
  fitImages: fakes.fit,
  reserveImages: fakes.reserve,
  readImageShares: vi.fn(async (_org: string, models: string[]) =>
    models.map(
      (model) => fakes.shares.find((share) => share.model === model) ?? { model, percent: null },
    ),
  ),
}));
vi.mock('../file-output', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../file-output')>()),
  fileChatImages: fakes.file,
  readChatStorage: vi.fn(async () => fakes.storage),
}));
vi.mock('./provider', () => ({ generateImages: fakes.generate }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: fakes.brandOrg ? { organization_id: fakes.brandOrg } : null,
          }),
        }),
      }),
    }),
  },
}));

const images = await import('./chat-images');
const { OwnKeyUnreadableError } = await import('../key');

const LITE = 'google/gemini-3.1-flash-lite-image';
const FLASH = 'google/gemini-3.1-flash-image';
const PRO = 'google/gemini-3-pro-image';
const GPT = 'openai/gpt-5-image-mini';
const BRAND = '11111111-1111-4111-8111-111111111111';
const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'admin' as const,
  apiKeyId: 'agent-internal',
  chat: {
    conversationId: 'chat-1',
    runId: 'run-1',
    agentRunId: null,
    approvalKey: 'step-1',
    executionMode: 'assisted' as const,
  },
};
const input = {
  brand_id: BRAND,
  model: LITE,
  prompt: 'Abstract dark cover, soft circles, no text',
  count: 4,
};
const ansvisorKey = {
  source: 'ansvisor',
  config: { provider: 'anthropic', apiKey: 'a', settings: {} },
};
const pixels = (n: number) => ({
  base64: Buffer.from([n, n]).toString('base64'),
  mimeType: 'image/jpeg',
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('OPENROUTER_API_KEY', 'or-ansvisor');
  fakes.agentic = true;
  fakes.chatKey = ansvisorKey;
  fakes.ownProvider = null;
  // Starter's $5: Lite 0.77%, Nano Banana 2 1.55%, Pro 3.1%, GPT 0.88% (W4-07's prices).
  fakes.shares = [
    { model: LITE, percent: 0.77 },
    { model: FLASH, percent: 1.55 },
    { model: PRO, percent: 3.1 },
    { model: GPT, percent: 0.88 },
  ];
  fakes.storage = { usedBytes: 0, limitBytes: null, fileCount: 0 };
  fakes.brandOrg = 'org-1';
  fakes.charge.mockReset().mockResolvedValue(undefined);
  fakes.release.mockReset().mockResolvedValue(undefined);
  fakes.reserve.mockReset().mockResolvedValue({
    ok: true,
    budget: { charge: fakes.charge, release: fakes.release, keep: vi.fn() },
  });
  fakes.generate
    .mockReset()
    .mockResolvedValue({ images: [1, 2, 3, 4].map(pixels), costUsd: 0.1344, refusals: [] });
  fakes.file.mockReset().mockResolvedValue({ ok: true, id: 'file-1' });
  fakes.fit.mockReset().mockResolvedValue({ ok: true, fits: 4, limit: 'month' });
});

describe('the key images run on', () => {
  it('is Ansvisor’s OpenRouter key, unless Chat runs on the workspace’s own OpenRouter key', async () => {
    expect(await images.imageKey('org-1')).toEqual({ key: 'or-ansvisor', source: 'ansvisor' });
    fakes.chatKey = { source: 'own', config: { provider: 'openrouter', apiKey: 'or-own' } };
    expect(await images.imageKey('org-1')).toEqual({ key: 'or-own', source: 'own' });
    // An own key of a provider that can't make these images: Ansvisor's, on the AI limit.
    fakes.chatKey = { source: 'own', config: { provider: 'anthropic', apiKey: 'sk-own' } };
    expect(await images.imageKey('org-1')).toEqual({ key: 'or-ansvisor', source: 'ansvisor' });
  });

  it('is none with Chat off or no key set, and never Ansvisor’s for an own key it can’t read', async () => {
    fakes.agentic = false;
    expect(await images.imageKey('org-1')).toBeNull();
    fakes.agentic = true;
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await images.imageKey('org-1')).toBeNull();
    vi.stubEnv('OPENROUTER_API_KEY', 'or-ansvisor');
    fakes.chatKey = new OwnKeyUnreadableError('openrouter');
    await expect(images.imageKey('org-1')).rejects.toBeInstanceOf(OwnKeyUnreadableError);
    fakes.chatKey = new OwnKeyUnreadableError('anthropic');
    expect(await images.imageKey('org-1')).toEqual({ key: 'or-ansvisor', source: 'ansvisor' });
  });
});

describe('the image model question (CHAT-15 item 17)', () => {
  it('offers the cheapest first, recommended, each with its multiplier and share per image', async () => {
    const asked = await images.imageModelQuestion(ctx);
    expect(asked).toMatchObject({ question: 'Which image model should I use?', ownKey: false });
    if (!('options' in asked)) throw new Error('no options');
    expect(asked.options).toEqual([
      {
        label: 'Nano Banana 2 Lite',
        detail: '1x · about 0.77% of your monthly AI limit per image · Fast and light',
        recommended: true,
      },
      {
        label: 'Nano Banana 2',
        detail: '2x · about 1.6% of your monthly AI limit per image · Sharper text in images',
        recommended: false,
      },
      {
        label: 'Nano Banana Pro',
        detail: '4x · about 3.1% of your monthly AI limit per image · Highest detail',
        recommended: false,
      },
      {
        label: 'GPT-5 Image Mini',
        detail: "1.1x · about 0.88% of your monthly AI limit per image · OpenAI's image model",
        recommended: false,
      },
    ]);
    expect(asked.models.map((m) => m.id)).toEqual([LITE, FLASH, PRO, GPT]);
  });

  it('says "Your key" on the workspace’s own key, and no share or multiplier without prices', async () => {
    fakes.ownProvider = 'openrouter';
    const own = await images.imageModelQuestion(ctx);
    if (!('options' in own)) throw new Error('no options');
    expect(own.ownKey).toBe(true);
    expect(own.options[0].detail).toBe('1x · Your key · Fast and light');
    fakes.ownProvider = null;
    fakes.shares = [];
    const plain = await images.imageModelQuestion(ctx);
    if (!('options' in plain)) throw new Error('no options');
    expect(plain.options[0]).toEqual({
      label: 'Nano Banana 2 Lite',
      detail: 'Fast and light',
      recommended: true,
    });
    expect(await images.imageModelQuestion({ organizationId: null })).toEqual({
      code: 'not_found',
    });
  });

  it('writes multipliers and shares as the menu does', () => {
    expect([1, 2, 1.14, 0.26, 12.4].map(images.multiplierOf)).toEqual([
      '1x',
      '2x',
      '1.1x',
      '0.3x',
      '12x',
    ]);
    expect([0.774, 1.55, 3.1, 12.6].map(images.percentOf)).toEqual(['0.77', '1.6', '3.1', '13']);
  });
});

describe('the parts check and the card', () => {
  it('counts the images the AI limit left covers on the key they run on', async () => {
    fakes.fit.mockResolvedValue({ ok: true, fits: 1, limit: 'month' });
    expect(
      await images.fitImageParts({
        organizationId: 'org-1',
        model: LITE,
        units: 4,
        agentRunId: null,
      }),
    ).toEqual({ fits: 1, limit: 'month' });
    expect(fakes.fit).toHaveBeenCalledWith({
      organizationId: 'org-1',
      model: LITE,
      images: 4,
      source: 'ansvisor',
      agentRunId: null,
    });
    // No answer: all of them, the request's own hold still decides.
    fakes.fit.mockResolvedValue({ ok: false, refusal: 'unavailable' });
    expect(
      await images.fitImageParts({
        organizationId: 'org-1',
        model: LITE,
        units: 4,
        agentRunId: null,
      }),
    ).toEqual({ fits: 4, limit: 'month' });
  });

  it('says on the card how many images, on which model, and their share of the AI limit', async () => {
    expect(await images.imageCostLine(BRAND, LITE, 4)).toBe(
      '4 images · Nano Banana 2 Lite · about 3.1% of your monthly AI limit',
    );
    fakes.ownProvider = 'openrouter';
    expect(await images.imageCostLine(BRAND, LITE, 1)).toBe(
      '1 image · Nano Banana 2 Lite · on your own key',
    );
    fakes.brandOrg = null;
    expect(await images.imageCostLine(BRAND, PRO, 2)).toBe('2 images · Nano Banana Pro');
  });

  it('stops before the card when Files has no room for the images', async () => {
    expect(await images.imagePrecheck('org-1', 4)).toBeNull();
    fakes.storage = { usedBytes: 100, limitBytes: 100, fileCount: 1 };
    expect(await images.imagePrecheck('org-1', 4)).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('a request', () => {
  it('holds the images, makes them at 1K, charges what the provider said and files one set', async () => {
    const made = await images.makeChatImages(ctx, { ...input, aspect_ratio: '16:9' });
    expect(fakes.reserve).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runId: 'run-1',
      model: LITE,
      images: 4,
      source: 'ansvisor',
      agentRunId: null,
    });
    expect(fakes.generate).toHaveBeenCalledWith({
      model: LITE,
      prompt: input.prompt,
      count: 4,
      size: '1K',
      key: 'or-ansvisor',
      aspectRatio: '16:9',
    });
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 4, costUsd: 0.1344 });
    expect(fakes.file).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        createdBy: 'user-1',
        brandId: BRAND,
        title: 'Images · Nano Banana 2 Lite',
        origin: 'chat',
        conversationId: 'chat-1',
        runId: 'run-1',
        messageId: null,
      }),
    );
    expect(fakes.file.mock.calls[0][0].images).toHaveLength(4);
    expect([...fakes.file.mock.calls[0][0].images[1].bytes]).toEqual([2, 2]);
    expect(made).toEqual({
      ok: true,
      file_id: 'file-1',
      title: 'Images · Nano Banana 2 Lite',
      format: 'jpg',
      images: 4,
      asked: 4,
      model: 'Nano Banana 2 Lite',
      prompt: input.prompt,
    });
  });

  it('runs on the workspace’s own OpenRouter key, which the AI limit doesn’t count', async () => {
    fakes.chatKey = { source: 'own', config: { provider: 'openrouter', apiKey: 'or-own' } };
    await images.makeChatImages(ctx, { ...input, title: 'Cover image · GEO 2026' });
    expect(fakes.reserve).toHaveBeenCalledWith(expect.objectContaining({ source: 'own' }));
    expect(fakes.generate).toHaveBeenCalledWith(expect.objectContaining({ key: 'or-own' }));
    expect(fakes.file).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Cover image · GEO 2026' }),
    );
  });

  it('says in one line why the model made none, charging only what it said it cost', async () => {
    fakes.generate.mockResolvedValue({
      images: [],
      costUsd: 0,
      refusals: ['Request blocked by safety\nfilters'],
    });
    expect(await images.makeChatImages(ctx, input)).toEqual({
      ok: false,
      reason: 'refused',
      message:
        "The image model didn't make an image for this prompt: Request blocked by safety filters",
    });
    expect(fakes.charge).toHaveBeenCalledWith({ produced: 0, costUsd: 0 });
    expect(fakes.file).not.toHaveBeenCalled();
  });

  it('makes nothing past the AI limit, without a key, or on an own key it can’t read', async () => {
    fakes.reserve.mockResolvedValue({ ok: false, refusal: 'budget_exhausted' });
    expect(await images.makeChatImages(ctx, input)).toMatchObject({
      ok: false,
      reason: 'quota_exceeded',
    });
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await images.makeChatImages(ctx, input)).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
    fakes.chatKey = new OwnKeyUnreadableError('openrouter');
    expect(await images.makeChatImages(ctx, input)).toMatchObject({
      ok: false,
      reason: 'unavailable',
      message: expect.stringContaining('own OpenRouter key'),
    });
    expect(fakes.generate).not.toHaveBeenCalled();
  });

  it('lets the hold go when the provider call throws', async () => {
    fakes.generate.mockRejectedValue(new Error('aborted'));
    await expect(images.makeChatImages(ctx, input)).rejects.toThrow('aborted');
    expect(fakes.release).toHaveBeenCalled();
    expect(fakes.charge).not.toHaveBeenCalled();
  });

  it('says so when the images couldn’t be filed', async () => {
    fakes.file.mockResolvedValue({ ok: false, failure: 'failed' });
    expect(await images.makeChatImages(ctx, input)).toMatchObject({
      ok: false,
      reason: 'unavailable',
      message: "The images were made but couldn't be saved to Files.",
    });
    expect(fakes.charge).toHaveBeenCalled();
  });
});
