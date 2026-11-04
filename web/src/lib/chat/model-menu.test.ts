// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_CHOICE,
  AUTO_MODEL,
  CHAT_MODELS,
  OFFERED_MODELS,
  isCatalogId,
  isChatModelChoice,
  latestChoice,
  modelChoiceOpen,
  offeredModel,
  runChoiceOf,
} from './models';
import { readModelMenu } from './model-menu';

/** The model menu for the browser (W4-01): labels from the API server, no price, a fallback. */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'shh');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const serverModel = (id: string, multiplier: string, tone: string) => ({
  id,
  name: id.split('/')[1],
  multiplier,
  tone,
  variesByHour: false,
  removed: false,
});

const answer = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('the offered models', () => {
  it('are the tested ones only: Haiku and Sonnet 5.5 at launch, Opus 5.5 since its test run', () => {
    expect(OFFERED_MODELS.map((m) => [m.id, m.api])).toEqual([
      ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5'],
      ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5'],
      ['anthropic/claude-opus-5.5', 'claude-opus-5-5'],
    ]);
    expect(OFFERED_MODELS).toEqual(CHAT_MODELS.filter((m) => m.tested));
    expect(OFFERED_MODELS.every((m) => m.tested)).toBe(true);
    expect(isChatModelChoice(AUTO_MODEL)).toBe(true);
    expect(isChatModelChoice('anthropic/claude-sonnet-5.5')).toBe(true);
    expect(isChatModelChoice('anthropic/claude-opus-5.5')).toBe(true);
    expect(offeredModel('anthropic/claude-opus-5.5')?.api).toBe('claude-opus-5-5');
    expect(isChatModelChoice('openai/gpt-6.1-sol')).toBe(false);
    expect(offeredModel('openai/gpt-6.1-sol')).toBeNull();
    expect(isChatModelChoice(undefined)).toBe(false);
    expect(offeredModel('auto')).toBeNull();
    expect(isCatalogId('openai/gpt-6.1-sol')).toBe(true);
    expect(isCatalogId('../../etc/passwd')).toBe(false);
  });
});

describe('a run’s model and effort (W4-02)', () => {
  it('lets Starter and up pick, the free trial run Auto, self-hosted pick', () => {
    expect(modelChoiceOpen({ selfHosted: false, isTrial: false })).toBe(true);
    expect(modelChoiceOpen({ selfHosted: false, isTrial: true })).toBe(false);
    expect(modelChoiceOpen({ selfHosted: true, isTrial: false })).toBe(true);
  });

  it('keeps what was asked when open and offered, else Auto at Normal', () => {
    const sonnet = { model: 'anthropic/claude-sonnet-5.5', effort: 'max' };
    expect(runChoiceOf(sonnet, true)).toEqual(sonnet);
    expect(runChoiceOf(sonnet, false)).toEqual(AUTO_CHOICE);
    // A model listed but not tested yet: Auto, the effort kept.
    expect(runChoiceOf({ model: 'openai/gpt-6.1-sol', effort: 'high' }, true)).toEqual({
      model: 'auto',
      effort: 'high',
    });
    expect(runChoiceOf({ model: 'openai/gpt-6.1-sol', effort: 'turbo' }, true)).toEqual(
      AUTO_CHOICE,
    );
    expect(runChoiceOf({}, true)).toEqual(AUTO_CHOICE);
  });

  it('starts a chat’s menu on its latest run’s pick', () => {
    expect(
      latestChoice([
        { model: 'anthropic/claude-haiku-5.5', effort: 'high', created_at: '2026-11-02T10:00:00Z' },
        { model: 'anthropic/claude-sonnet-5.5', effort: 'max', created_at: '2026-11-02T11:00:00Z' },
      ]),
    ).toEqual({ model: 'anthropic/claude-sonnet-5.5', effort: 'max' });
    // A chat whose latest run was on a model not tested opens on Auto.
    expect(
      latestChoice([
        {
          model: 'openai/gpt-6.1-sol',
          effort: 'normal',
          created_at: '2026-11-02T12:00:00Z',
        },
      ]),
    ).toEqual(AUTO_CHOICE);
    expect(latestChoice([])).toEqual(AUTO_CHOICE);
  });
});

describe('readModelMenu', () => {
  it('asks the API server for the tested models only, with its secret, and adds Your key', async () => {
    answer({
      success: true,
      models: [
        serverModel('anthropic/claude-haiku-5.5', '0.1x', 'low'),
        serverModel('anthropic/claude-sonnet-5.5', '2.3x', 'normal'),
        serverModel('anthropic/claude-opus-5.5', '4.7x', 'high'),
        serverModel('openai/gpt-6.1-sol', '2.3x', 'normal'),
      ],
      selected: null,
      catalogCount: 312,
      updatedAt: '2026-11-02T05:17:00.000Z',
    });
    const menu = await readModelMenu({ ownKeyProviders: ['anthropic'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      '/api/internal/chat/models?ids=anthropic%2Fclaude-haiku-5.5%2Canthropic%2Fclaude-sonnet-5.5%2Canthropic%2Fclaude-opus-5.5',
    );
    expect(String(url)).not.toContain('gpt');
    expect(init.headers).toEqual({ Authorization: 'Bearer shh' });
    expect(menu.auto).toEqual({ id: 'auto', multiplier: '1x', tone: 'normal' });
    // A model not tested stays out, even when the server answers for it.
    expect(menu.models.map((m) => [m.id, m.multiplier, m.tone, m.yourKey])).toEqual([
      ['anthropic/claude-haiku-5.5', '0.1x', 'low', true],
      ['anthropic/claude-sonnet-5.5', '2.3x', 'normal', true],
      ['anthropic/claude-opus-5.5', '4.7x', 'high', true],
    ]);
    expect(menu.catalogCount).toBe(312);
    expect(menu.updatedAt).toBe('2026-11-02T05:17:00.000Z');
    expect(menu.selected).toBeNull();
  });

  it('marks Your key where an own key runs the model: its provider’s, else OpenRouter’s', async () => {
    const yourKeys = async (ownKeyProviders: string[]) => {
      answer({
        models: [serverModel('anthropic/claude-haiku-5.5', '0.1x', 'low')],
        catalogCount: 1,
        updatedAt: null,
      });
      return (await readModelMenu({ ownKeyProviders })).models.map((m) => m.yourKey);
    };
    // An OpenRouter key runs a picked Claude model by its catalog id.
    expect(await yourKeys(['openai', 'openrouter'])).toEqual([true]);
    // An OpenAI key doesn't run a Claude model, even when it is the active one.
    expect(await yourKeys(['openai'])).toEqual([false]);
    expect(await yourKeys([])).toEqual([false]);
  });

  it('leaves out a model the catalog dropped, and says when the chat’s model was dropped', async () => {
    answer({
      models: [serverModel('anthropic/claude-haiku-5.5', '0.1x', 'low')],
      selected: { ...serverModel('anthropic/claude-sonnet-5.5', '2.3x', 'normal'), removed: true },
      catalogCount: 300,
      updatedAt: null,
    });
    const menu = await readModelMenu({ selected: 'anthropic/claude-sonnet-5.5' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('selected=anthropic%2Fclaude-sonnet-5.5');
    expect(menu.models.map((m) => m.id)).toEqual(['anthropic/claude-haiku-5.5']);
    expect(menu.models[0].yourKey).toBe(false);
    expect(menu.selected).toEqual({ id: 'anthropic/claude-sonnet-5.5', removed: true });
  });

  it('counts a model no longer offered, or not tested yet, as removed, and Auto as no selection', async () => {
    answer({ models: [], catalogCount: 0, updatedAt: null });
    // A chat that picked a model not offered (here, one never listed): it runs Auto.
    expect((await readModelMenu({ selected: 'openai/gpt-6.1-sol' })).selected).toEqual({
      id: 'openai/gpt-6.1-sol',
      removed: true,
    });
    expect((await readModelMenu({ selected: 'auto' })).selected).toBeNull();
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('selected=');
  });

  it('still lists the offered models, unlabelled, when the API server doesn’t answer', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    const menu = await readModelMenu();
    expect(menu.models.map((m) => [m.id, m.multiplier, m.tone])).toEqual(
      OFFERED_MODELS.map((m) => [m.id, null, null]),
    );
    answer({}, 502);
    expect((await readModelMenu()).models).toHaveLength(3);
    vi.stubEnv('CRON_SECRET', '');
    fetchMock.mockReset();
    expect((await readModelMenu()).models).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
