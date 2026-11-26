import { describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../logger.js', () => ({ logger: { warn }, default: { warn } }));
vi.mock('../../config/supabase.js', () => ({ default: {} }));
const loadSupportedCountries = vi.hoisted(() =>
  vi.fn(async () => new Map([['chatgpt', new Set(['US'])]])),
);
vi.mock('../cloro-countries.js', () => ({
  loadSupportedCountries,
  CLORO_COUNTRY_MODELS: {
    'chatgpt-web': 'chatgpt',
    'chatgpt-shopping': 'chatgpt',
    'copilot-web': 'bing_aimode',
  },
}));

const {
  answerProvider,
  DEFAULT_PROVIDER,
  platformOverrides,
  PROVIDER_NAMES,
  providerFor,
  providerName,
  providersInUse,
  supportedCountries,
  unavailablePlatforms,
} = await import('./index.js');
const cloroScraper = await import('../cloro-scraper.js');

/**
 * PLATFORM_PROVIDER picks the service that asks the AI platforms. Until now
 * nothing read it and every install used Cloro, so unset, blank and unknown
 * values must still mean Cloro.
 */
describe('answer providers', () => {
  it('uses Cloro when PLATFORM_PROVIDER is unset or blank', () => {
    expect(DEFAULT_PROVIDER).toBe('cloro');
    expect(providerName({})).toBe('cloro');
    expect(providerName({ PLATFORM_PROVIDER: '  ' })).toBe('cloro');
    expect(answerProvider('cloro').name).toBe('cloro');
  });

  it('reads the name in any case', () => {
    expect(providerName({ PLATFORM_PROVIDER: ' Cloro ' })).toBe('cloro');
    expect(providerName({ PLATFORM_PROVIDER: 'ANAKIN' })).toBe('anakin');
  });

  it('gives Anakin its scraper, and its webhook only with a signing secret', async () => {
    const anakinScraper = await import('../anakin-scraper.js');
    const anakin = answerProvider('anakin');
    expect(anakin.name).toBe('anakin');
    expect(anakin.submitPromptTask).toBe(anakinScraper.submitPromptTask);
    expect(anakin.pollScraperResult).toBe(anakinScraper.pollScraperResult);
    expect(anakin.parseScraperResponse).toBe(anakinScraper.parseScraperResponse);
    expect(anakin.unavailablePlatforms()).toEqual(['deepseek-web']);
    expect(
      anakin.webhookUrl({
        ANAKIN_WEBHOOK_URL: 'https://api.example/anakin/callback',
        ANAKIN_WEBHOOK_SECRET: 'whsec_test',
      }),
    ).toBe('https://api.example/anakin/callback');
    // The route takes signed deliveries only: no secret, no webhook, poll.
    expect(
      anakin.webhookUrl({ ANAKIN_WEBHOOK_URL: 'https://api.example/anakin/callback' }),
    ).toBeNull();
    expect(anakin.webhookUrl({})).toBeNull();
    expect(await anakin.supportedCountries()).toEqual(new Map());
  });

  it('falls back to Cloro on an unknown name, warning once', () => {
    warn.mockClear();
    expect(providerName({ PLATFORM_PROVIDER: 'nope' })).toBe('cloro');
    expect(providerName({ PLATFORM_PROVIDER: 'nope' })).toBe('cloro');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(answerProvider('nope').name).toBe('cloro');
  });

  it('lists the known providers', () => {
    expect(PROVIDER_NAMES).toEqual(['cloro', 'anakin']);
  });

  it('gives Cloro its scraper unchanged', () => {
    const cloro = answerProvider('cloro');
    expect(cloro.submitPromptTask).toBe(cloroScraper.submitPromptTask);
    expect(cloro.submitScraperTask).toBe(cloroScraper.submitScraperTask);
    expect(cloro.pollScraperResult).toBe(cloroScraper.pollScraperResult);
    expect(cloro.parseScraperResponse).toBe(cloroScraper.parseScraperResponse);
    expect(cloro.isLegacyChatgptTask).toBe(cloroScraper.isLegacyChatgptTask);
    expect(cloro.unavailablePlatforms()).toBe(cloroScraper.UNAVAILABLE_PLATFORMS);
  });

  it("reads Cloro's country lists for Cloro only", async () => {
    expect(await answerProvider('cloro').supportedCountries()).toEqual(
      new Map([['chatgpt', new Set(['US'])]]),
    );
    loadSupportedCountries.mockClear();
    expect(await answerProvider('anakin').supportedCountries()).toEqual(new Map());
    expect(loadSupportedCountries).not.toHaveBeenCalled();
  });

  it("takes Cloro's webhook from CLORO_WEBHOOK_URL, else polls", () => {
    const cloro = answerProvider('cloro');
    expect(cloro.webhookUrl({ CLORO_WEBHOOK_URL: 'https://api.example/cloro/callback' })).toBe(
      'https://api.example/cloro/callback',
    );
    expect(cloro.webhookUrl({ CLORO_WEBHOOK_URL: '' })).toBeNull();
    expect(cloro.webhookUrl({})).toBeNull();
  });
});

/**
 * PLATFORM_PROVIDER_OVERRIDES moves single platforms to the other provider:
 * the cloud runs Anakin but keeps Bing AI Mode (copilot-web) on Cloro.
 */
describe('per-platform providers', () => {
  const split = { PLATFORM_PROVIDER: 'anakin', PLATFORM_PROVIDER_OVERRIDES: 'copilot-web=cloro' };

  it('sends each platform to its override, the rest to PLATFORM_PROVIDER', () => {
    expect(providerFor('copilot-web', split).name).toBe('cloro');
    expect(providerFor('chatgpt-web', split).name).toBe('anakin');
    expect(providersInUse(split).map((p) => p.name)).toEqual(['anakin', 'cloro']);
  });

  it('changes nothing when unset or blank', () => {
    for (const env of [{}, { PLATFORM_PROVIDER_OVERRIDES: ' , ' }]) {
      expect(platformOverrides(env).size).toBe(0);
      expect(providerFor('copilot-web', env).name).toBe('cloro');
      expect(providersInUse(env).map((p) => p.name)).toEqual(['cloro']);
    }
  });

  it('reads pairs in any case and spacing, and ignores broken ones with a warning', () => {
    warn.mockClear();
    const overrides = platformOverrides({
      PLATFORM_PROVIDER_OVERRIDES: ' Copilot-Web = CLORO , grok-web=nowhere, gemini-web, a=b=c ',
    });
    expect([...overrides]).toEqual([['copilot-web', 'cloro']]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("skips a platform only when its own provider can't deliver it", () => {
    // Cloro can't deliver Grok or Perplexity; Anakin can. Anakin can't deliver DeepSeek yet.
    expect(unavailablePlatforms({ PLATFORM_PROVIDER: 'cloro' }).sort()).toEqual([
      'grok-web',
      'perplexity-web',
    ]);
    expect(unavailablePlatforms(split)).toEqual(['deepseek-web']);
    expect(
      unavailablePlatforms({
        PLATFORM_PROVIDER: 'anakin',
        PLATFORM_PROVIDER_OVERRIDES: 'grok-web=cloro',
      }).sort(),
    ).toEqual(['deepseek-web', 'grok-web']);
  });

  it('checks countries only for the platforms on the provider whose list it is', async () => {
    loadSupportedCountries.mockResolvedValueOnce(
      new Map([
        ['chatgpt', new Set(['US'])],
        ['bing_aimode', new Set(['US', 'DE'])],
      ]),
    );
    // ChatGPT is on Anakin (no lists), Bing on Cloro: only Bing's list stays.
    expect([...(await supportedCountries(split)).keys()]).toEqual(['bing_aimode']);
  });
});
