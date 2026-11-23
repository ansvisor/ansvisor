import { describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../logger.js', () => ({ logger: { warn }, default: { warn } }));
vi.mock('../../config/supabase.js', () => ({ default: {} }));
const loadSupportedCountries = vi.hoisted(() =>
  vi.fn(async () => new Map([['chatgpt', new Set(['US'])]])),
);
vi.mock('../cloro-countries.js', () => ({ loadSupportedCountries }));

const { answerProvider, DEFAULT_PROVIDER, PROVIDER_NAMES, providerName } =
  await import('./index.js');
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

  it('gives Anakin its scraper and its webhook from ANAKIN_WEBHOOK_URL', async () => {
    const anakinScraper = await import('../anakin-scraper.js');
    const anakin = answerProvider('anakin');
    expect(anakin.name).toBe('anakin');
    expect(anakin.submitPromptTask).toBe(anakinScraper.submitPromptTask);
    expect(anakin.pollScraperResult).toBe(anakinScraper.pollScraperResult);
    expect(anakin.parseScraperResponse).toBe(anakinScraper.parseScraperResponse);
    expect(anakin.unavailablePlatforms()).toEqual([]);
    expect(anakin.webhookUrl({ ANAKIN_WEBHOOK_URL: 'https://api.example/anakin/callback' })).toBe(
      'https://api.example/anakin/callback',
    );
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
