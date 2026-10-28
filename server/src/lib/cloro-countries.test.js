import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './catalog/__fixtures__/fake-db.js';
import {
  fetchCloroCountries,
  loadSupportedCountries,
  refreshCloroCountries,
  supportedLocations,
  supportsCountry,
} from './cloro-countries.js';

/** The countries each tracking engine answers from (PROMPT-015e). */

const answer = (lists) =>
  vi.fn(async (url) => {
    const model = new URL(url).searchParams.get('model');
    const list = lists[model];
    if (list instanceof Error) throw list;
    if (list === 500) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => list ?? ['US'] };
  });

describe('fetchCloroCountries', () => {
  it("reads an engine's codes with the key, and nothing without one", async () => {
    const fetchImpl = answer({ chatgpt: ['us', 'GB', 'GB', 'xx1', 7] });
    expect(await fetchCloroCountries('chatgpt', { fetchImpl, apiKey: 'k' })).toEqual(['US', 'GB']);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.cloro.dev/v1/countries?model=chatgpt');
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer k' });
    expect(await fetchCloroCountries('chatgpt', { fetchImpl, apiKey: '' })).toBeNull();
  });

  it('reads an empty or malformed answer as no list, never as "no countries"', async () => {
    expect(
      await fetchCloroCountries('gemini', { fetchImpl: answer({ gemini: [] }), apiKey: 'k' }),
    ).toBeNull();
    expect(
      await fetchCloroCountries('gemini', {
        fetchImpl: answer({ gemini: { codes: [] } }),
        apiKey: 'k',
      }),
    ).toBeNull();
    await expect(
      fetchCloroCountries('gemini', { fetchImpl: answer({ gemini: 500 }), apiKey: 'k' }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('refreshCloroCountries', () => {
  it('writes each engine’s list, drops what it no longer lists, and keeps a list it could not read', async () => {
    const fake = fakeDb();
    const day1 = new Date('2026-10-27T06:00:00Z');
    await refreshCloroCountries({
      db: fake.db,
      apiKey: 'k',
      now: day1,
      fetchImpl: answer({ chatgpt: ['US', 'GB', 'CZ'], copilot: ['US', 'BR'] }),
    });
    const day2 = new Date('2026-10-28T06:00:00Z');
    const outcome = await refreshCloroCountries({
      db: fake.db,
      apiKey: 'k',
      now: day2,
      fetchImpl: answer({
        // CZ dropped from ChatGPT; Copilot's read fails and keeps yesterday's.
        chatgpt: ['US', 'GB'],
        copilot: new Error('timeout'),
      }),
    });
    expect(outcome).toMatchObject({ chatgpt: 2, copilot: 'kept' });
    const supported = await loadSupportedCountries({ db: fake.db });
    expect([...supported.get('chatgpt')].sort()).toEqual(['GB', 'US']);
    expect([...supported.get('copilot')].sort()).toEqual(['BR', 'US']);
  });

  it('reads nothing without the provider key', async () => {
    const fetchImpl = answer({});
    expect(await refreshCloroCountries({ db: fakeDb().db, apiKey: '', fetchImpl })).toEqual({
      skipped: 'no provider key',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('supportsCountry and supportedLocations', () => {
  const supported = new Map([
    ['copilot', new Set(['US', 'TR'])],
    ['aimode', new Set(['US', 'TR', 'KE'])],
  ]);

  it('asks an engine only where it answers from', () => {
    expect(supportsCountry(supported, 'copilot-web', 'KE')).toBe(false);
    expect(supportsCountry(supported, 'copilot-web', 'TR')).toBe(true);
  });

  it('restricts nothing it has no list for', () => {
    // No list read for ChatGPT, the API models aren't the provider's, an untargeted run.
    expect(supportsCountry(supported, 'chatgpt-web', 'KE')).toBe(true);
    expect(supportsCountry(supported, 'gpt-5', 'KE')).toBe(true);
    expect(supportsCountry(supported, 'copilot-web', null)).toBe(true);
    expect(supportsCountry(new Map(), 'copilot-web', 'KE')).toBe(true);
  });

  it('skips a country an engine does not support, cities and states included', () => {
    const codes = ['US', 'KE', 'TR~ISTANBUL', 'US-CA'];
    expect(supportedLocations(codes, 'copilot-web', supported)).toEqual(['US', 'US-CA']);
    expect(supportedLocations(codes, 'google-aimode', supported)).toEqual([
      'US',
      'KE',
      'TR~ISTANBUL',
    ]);
    expect(supportedLocations([], 'copilot-web', supported)).toEqual([null]);
  });
});
