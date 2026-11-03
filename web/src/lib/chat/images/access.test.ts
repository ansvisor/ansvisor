// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Whose key images run on and what each image model costs as a share
 * (W4-08, W4-09): the workspace's own OpenRouter key or Ansvisor's, and
 * the image models with their multipliers and shares, the cheapest first.
 */

const fakes = vi.hoisted(() => ({
  agentic: true,
  chatKey: null as unknown,
  ownProvider: null as string | null,
  shares: [] as { model: string; percent: number | null }[],
  // chat_settings.model_providers (W4-34), or the read's error.
  providers: null as Record<string, boolean> | null,
  providersError: null as { code?: string; message: string } | null,
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
  readImageShares: vi.fn(async (_org: string, models: string[]) =>
    models.map(
      (model) => fakes.shares.find((share) => share.model === model) ?? { model, percent: null },
    ),
  ),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: fakes.providers && { model_providers: fakes.providers },
            error: fakes.providersError,
          }),
        }),
      }),
    }),
  },
}));

const access = await import('./access');
const { OwnKeyUnreadableError } = await import('../key');

const LITE = 'google/gemini-3.1-flash-lite-image';
const FLASH = 'google/gemini-3.1-flash-image';
const PRO = 'google/gemini-3-pro-image';
const GPT = 'openai/gpt-5-image-mini';
const ansvisorKey = {
  source: 'ansvisor',
  config: { provider: 'anthropic', apiKey: 'a', settings: {} },
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('OPENROUTER_API_KEY', 'or-ansvisor');
  fakes.agentic = true;
  fakes.chatKey = ansvisorKey;
  fakes.ownProvider = null;
  fakes.providers = null;
  fakes.providersError = null;
  // Starter's $5: Lite 0.77%, Nano Banana 2 1.55%, Pro 3.1%, GPT 0.88% (W4-07's prices).
  fakes.shares = [
    { model: LITE, percent: 0.77 },
    { model: FLASH, percent: 1.55 },
    { model: PRO, percent: 3.1 },
    { model: GPT, percent: 0.88 },
  ];
});

describe('the key images run on', () => {
  it('is Ansvisor’s OpenRouter key, unless Chat runs on the workspace’s own OpenRouter key', async () => {
    expect(await access.imageKey('org-1')).toEqual({ key: 'or-ansvisor', source: 'ansvisor' });
    fakes.chatKey = { source: 'own', config: { provider: 'openrouter', apiKey: 'or-own' } };
    expect(await access.imageKey('org-1')).toEqual({ key: 'or-own', source: 'own' });
    // An own key of a provider that can't make these images: Ansvisor's, on the AI limit.
    fakes.chatKey = { source: 'own', config: { provider: 'anthropic', apiKey: 'sk-own' } };
    expect(await access.imageKey('org-1')).toEqual({ key: 'or-ansvisor', source: 'ansvisor' });
  });

  it('is none with Chat off or no key set, and never Ansvisor’s for an own key it can’t read', async () => {
    fakes.agentic = false;
    expect(await access.imageKey('org-1')).toBeNull();
    fakes.agentic = true;
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await access.imageKey('org-1')).toBeNull();
    vi.stubEnv('OPENROUTER_API_KEY', 'or-ansvisor');
    fakes.chatKey = new OwnKeyUnreadableError('openrouter');
    await expect(access.imageKey('org-1')).rejects.toBeInstanceOf(OwnKeyUnreadableError);
    fakes.chatKey = new OwnKeyUnreadableError('anthropic');
    expect(await access.imageKey('org-1')).toEqual({ key: 'or-ansvisor', source: 'ansvisor' });
  });

  it('reads whose key without decrypting it', async () => {
    expect(await access.imageKeySource('org-1')).toBe('ansvisor');
    fakes.ownProvider = 'openrouter';
    expect(await access.imageKeySource('org-1')).toBe('own');
    fakes.ownProvider = 'anthropic';
    expect(await access.imageKeySource('org-1')).toBe('ansvisor');
  });
});

describe('the image models with their costs', () => {
  it('lists the cheapest first, recommended, each with its multiplier and share per image', async () => {
    expect(await access.imageModelOptions('org-1')).toEqual({
      ownKey: false,
      models: [
        {
          id: LITE,
          label: 'Nano Banana 2 Lite',
          multiplier: '1x',
          sharePercent: 0.77,
          recommended: true,
        },
        {
          id: FLASH,
          label: 'Nano Banana 2',
          multiplier: '2x',
          sharePercent: 1.55,
          recommended: false,
        },
        {
          id: PRO,
          label: 'Nano Banana Pro',
          multiplier: '4x',
          sharePercent: 3.1,
          recommended: false,
        },
        {
          id: GPT,
          label: 'GPT-5 Image Mini',
          multiplier: '1.1x',
          sharePercent: 0.88,
          recommended: false,
        },
      ],
    });
  });

  it('shows no share on the workspace’s own key, and no multiplier without prices', async () => {
    fakes.ownProvider = 'openrouter';
    const own = await access.imageModelOptions('org-1');
    expect(own.ownKey).toBe(true);
    expect(own.models.map((m) => [m.multiplier, m.sharePercent])[0]).toEqual(['1x', null]);
    fakes.ownProvider = null;
    fakes.shares = [];
    const plain = await access.imageModelOptions('org-1');
    expect(plain.models[0]).toMatchObject({ id: LITE, multiplier: null, sharePercent: null });
  });

  it('writes multipliers and shares as the menu does', () => {
    expect([1, 2.07, 4.13, 1.14, 0.26, 12.4].map(access.multiplierOf)).toEqual([
      '1x',
      '2x',
      '4x',
      '1.1x',
      '0.3x',
      '12x',
    ]);
    expect([0.774, 1.55, 3.1, 12.6].map(access.percentOf)).toEqual(['0.77', '1.6', '3.1', '13']);
  });
});

describe('the image models an Admin turned off (W4-34)', () => {
  it('lists only the models whose maker is on, the cheapest of them recommended', async () => {
    fakes.providers = { google: false };
    expect(await access.imageModelOptions('org-1')).toEqual({
      ownKey: false,
      models: [
        {
          id: GPT,
          label: 'GPT-5 Image Mini',
          multiplier: '1x',
          sharePercent: 0.88,
          recommended: true,
        },
      ],
    });
    expect(await access.imageModelOn('org-1', LITE)).toBe(false);
    expect(await access.imageModelOn('org-1', GPT)).toBe(true);
    fakes.providers = { openai: false, google: false };
    expect((await access.imageModelOptions('org-1')).models).toEqual([]);
  });

  it('reads every maker on its default before the setting exists, and off when it can’t be read', async () => {
    fakes.providersError = {
      code: '42703',
      message: 'column chat_settings.model_providers does not exist',
    };
    expect(await access.imageModelOn('org-1', LITE)).toBe(true);
    fakes.providersError = { message: 'timeout' };
    expect(await access.imageModelOn('org-1', LITE)).toBe(false);
    expect(await access.imageModelOn('org-1', GPT)).toBe(false);
  });
});
