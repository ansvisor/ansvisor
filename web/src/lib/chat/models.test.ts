// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEEPSEEK_US_EU_PROVIDERS, openRouterRouting } from '@/lib/agent/openrouter';
import {
  CHAT_MODELS,
  OFFERED_MODELS,
  chatModelLabel,
  isChatModelChoice,
  offeredModel,
  pickedModelKeyOrder,
  runChoiceOf,
} from './models';

/** The models Chat may run once tested (W4-35), and what the AI budget prices them at (W4-36). */

/**
 * The hosts the API server prices a maker's models at (server
 * lib/model-prices.js, LIMITED_HOSTS), read from its source; null when it
 * lists none for the maker.
 */
function serverHosts(maker: string): string[] | null {
  const source = readFileSync(
    new URL('../../../../server/src/lib/model-prices.js', import.meta.url),
    'utf8',
  );
  const hosts = source.match(
    /export const LIMITED_HOSTS = Object\.freeze\(\{([\s\S]*?)\n\}\);/,
  )?.[1];
  const list = hosts?.match(new RegExp(`\\b${maker}: Object\\.freeze\\(\\[([^\\]]*)\\]`))?.[1];
  return list ? [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]) : null;
}

describe('CHAT_MODELS', () => {
  it('prices DeepSeek on the server at the hosts the web runs it on (W4-36)', () => {
    expect(serverHosts('deepseek')).toEqual(DEEPSEEK_US_EU_PROVIDERS);
    expect(serverHosts('openai')).toBeNull();
  });

  it('tests a model whose hosts Ansvisor limits only once the AI budget prices it at theirs (W4-36)', () => {
    // DeepSeek runs only on US and EU hosts (W4-34), dearer than the catalog's price, which is
    // its cheapest provider's: on that price the budget would count less than it costs.
    const limited = CHAT_MODELS.filter((model) => openRouterRouting(model.id).only);
    expect(limited.map((model) => model.id)).toContain('deepseek/deepseek-v4.1-flash');
    for (const model of limited.filter((m) => m.tested)) {
      expect(serverHosts(model.id.split('/')[0]), model.id).toEqual(
        openRouterRouting(model.id).only,
      );
    }
  });

  it('offers GPT-6.1 Sol, GPT-6.1 Terra and GPT-6 Luna, which passed the test set twice in a row (2026-11-03)', () => {
    const offered = OFFERED_MODELS.map((model) => model.id);
    for (const id of ['openai/gpt-6.1-sol', 'openai/gpt-6.1-terra', 'openai/gpt-6-luna']) {
      expect(offered, id).toContain(id);
      expect(CHAT_MODELS.find((model) => model.id === id)?.provider, id).toBe('openrouter');
    }
  });

  it('offers Gemini 4 Argon, which passed the test set twice in a row (2026-11-03)', () => {
    const offered = OFFERED_MODELS.map((model) => model.id);
    for (const id of ['google/gemini-4-argon']) {
      expect(offered, id).toContain(id);
      expect(CHAT_MODELS.find((model) => model.id === id)?.provider, id).toBe('openrouter');
    }
  });
});

/** An API server file's source, as models.test.ts reads LIMITED_HOSTS. */
const serverSource = (file: string) =>
  readFileSync(new URL(`../../../../server/src/lib/${file}`, import.meta.url), 'utf8');

describe('Claude Fable 5.2', () => {
  const FABLE = CHAT_MODELS.find((model) => model.id === 'anthropic/claude-fable-5-2')!;

  it('is listed for its test set and not offered: a run that asks for it runs Auto', () => {
    expect(FABLE).toMatchObject({
      api: 'claude-fable-5-2',
      provider: 'anthropic',
      label: 'Fable 5.2',
      tested: false,
    });
    expect(OFFERED_MODELS).not.toContain(FABLE);
    expect(offeredModel(FABLE.id)).toBeNull();
    expect(isChatModelChoice(FABLE.id)).toBe(false);
    expect(runChoiceOf({ model: FABLE.id, effort: 'max' }, true)).toEqual({
      model: 'auto',
      effort: 'max',
    });
    expect(chatModelLabel(FABLE.id)).toBe('Fable 5.2');
  });

  it('carries its API rules: effort high at Normal, its thinking bound, a refusal ending the run', () => {
    expect(FABLE).toMatchObject({ normalEffort: 'high', boundThinking: true, refusalStop: true });
    // No other model takes them on.
    for (const model of CHAT_MODELS.filter((m) => m !== FABLE)) {
      expect(
        model.normalEffort ?? model.boundThinking ?? model.refusalStop,
        model.id,
      ).toBeUndefined();
    }
  });

  it('runs on Anthropic’s API only, never through OpenRouter, and is no part of Auto', () => {
    expect(FABLE.directOnly).toBe(true);
    expect(pickedModelKeyOrder(FABLE.provider, FABLE.directOnly)).toEqual(['anthropic']);
    expect(pickedModelKeyOrder('anthropic')).toEqual(['anthropic', 'openrouter']);
    // Auto's mix, and the price sync's catalog, never name it.
    expect(serverSource('model-prices.js')).not.toContain('fable');
  });

  it('is priced as the API server prices it: Anthropic’s list price, never the catalog’s', () => {
    // USD per million tokens: $8 in, $40 out, $0.20 a cache read, $10 a 5-minute cache write.
    expect(FABLE.price).toEqual({ input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 });
    const cost = serverSource('improve-cost.js');
    expect(cost).toContain(
      `'anthropic/claude-fable-5-2': { input: ${FABLE.price!.input}, output: ${FABLE.price!.output}, cacheRead: ${FABLE.price!.cacheRead} }`,
    );
    expect(cost).toMatch(/DIRECT_MODELS = Object\.freeze\(\['anthropic\/claude-fable-5-2'\]\)/);
    // The server prices a cache write at its input price times this.
    const multiplier = Number(cost.match(/CACHE_WRITE_MULTIPLIER = ([\d.]+)/)?.[1]);
    expect(FABLE.price!.input * multiplier).toBe(FABLE.price!.cacheWrite);
  });
});
