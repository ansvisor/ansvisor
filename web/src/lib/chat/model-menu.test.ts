// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_MODEL, OFFERED_MODELS, isCatalogId, isChatModelChoice, offeredModel } from './models';
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
  it('are Claude’s three at launch, each with its catalog and API id', () => {
    expect(OFFERED_MODELS.map((m) => [m.id, m.api])).toEqual([
      ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5'],
      ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5'],
      ['anthropic/claude-opus-5.5', 'claude-opus-5-5'],
    ]);
    expect(isChatModelChoice(AUTO_MODEL)).toBe(true);
    expect(isChatModelChoice('anthropic/claude-opus-5.5')).toBe(true);
    expect(isChatModelChoice('openai/gpt-6.1-sol')).toBe(false);
    expect(isChatModelChoice(undefined)).toBe(false);
    expect(offeredModel('auto')).toBeNull();
    expect(isCatalogId('openai/gpt-6.1-sol')).toBe(true);
    expect(isCatalogId('../../etc/passwd')).toBe(false);
  });
});

describe('readModelMenu', () => {
  it('asks the API server for the offered models with its secret, and adds Your key', async () => {
    answer({
      success: true,
      models: [
        serverModel('anthropic/claude-haiku-5.5', '0.1x', 'low'),
        serverModel('anthropic/claude-sonnet-5.5', '2.3x', 'normal'),
        serverModel('anthropic/claude-opus-5.5', '4.7x', 'high'),
      ],
      selected: null,
      catalogCount: 312,
      updatedAt: '2026-11-02T05:17:00.000Z',
    });
    const menu = await readModelMenu({ ownKeyProvider: 'anthropic' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      '/api/internal/chat/models?ids=anthropic%2Fclaude-haiku-5.5%2Canthropic%2Fclaude-sonnet-5.5%2Canthropic%2Fclaude-opus-5.5',
    );
    expect(init.headers).toEqual({ Authorization: 'Bearer shh' });
    expect(menu.auto).toEqual({ id: 'auto', multiplier: '1x', tone: 'normal' });
    expect(menu.models.map((m) => [m.id, m.multiplier, m.tone, m.yourKey])).toEqual([
      ['anthropic/claude-haiku-5.5', '0.1x', 'low', true],
      ['anthropic/claude-sonnet-5.5', '2.3x', 'normal', true],
      ['anthropic/claude-opus-5.5', '4.7x', 'high', true],
    ]);
    expect(menu.catalogCount).toBe(312);
    expect(menu.updatedAt).toBe('2026-11-02T05:17:00.000Z');
    expect(menu.selected).toBeNull();
  });

  it('leaves out a model the catalog dropped, and says when the chat’s model was dropped', async () => {
    answer({
      models: [serverModel('anthropic/claude-haiku-5.5', '0.1x', 'low')],
      selected: { ...serverModel('anthropic/claude-opus-5.5', '4.7x', 'high'), removed: true },
      catalogCount: 300,
      updatedAt: null,
    });
    const menu = await readModelMenu({ selected: 'anthropic/claude-opus-5.5' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('selected=anthropic%2Fclaude-opus-5.5');
    expect(menu.models.map((m) => m.id)).toEqual(['anthropic/claude-haiku-5.5']);
    expect(menu.models[0].yourKey).toBe(false);
    expect(menu.selected).toEqual({ id: 'anthropic/claude-opus-5.5', removed: true });
  });

  it('counts a model no longer offered as removed, and Auto as no selection', async () => {
    answer({ models: [], catalogCount: 0, updatedAt: null });
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
