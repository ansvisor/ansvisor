import { describe, expect, it } from 'vitest';
import {
  MODEL_PROVIDERS,
  PROVIDERS_OFF,
  keyModelProvider,
  modelProviderOn,
  parseProviderChoices,
  providerOfModel,
  providerOn,
} from './model-providers';

/** The model providers a workspace lets Chat use (W4-34). */

describe('model providers', () => {
  it('list Anthropic locked on, OpenAI and Google on, DeepSeek off by default', () => {
    expect(MODEL_PROVIDERS.map((p) => [p.id, p.defaultOn, p.locked])).toEqual([
      ['anthropic', true, true],
      ['openai', true, false],
      ['google', true, false],
      ['deepseek', false, false],
    ]);
    expect(['anthropic', 'openai', 'google', 'deepseek'].map((p) => providerOn({}, p))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('follow the Admin’s choice, never turning Anthropic off, and keep an unknown provider off', () => {
    const choices = { anthropic: false, openai: false, deepseek: true };
    expect(providerOn(choices, 'anthropic')).toBe(true);
    expect(providerOn(choices, 'openai')).toBe(false);
    expect(providerOn(choices, 'deepseek')).toBe(true);
    expect(providerOn(choices, 'google')).toBe(true);
    expect(providerOn(choices, 'x-ai')).toBe(false);
    expect(providerOn(choices, null)).toBe(false);
  });

  it('read a model’s provider from its catalog id, Auto always on', () => {
    expect(providerOfModel('openai/gpt-6.1-sol')).toBe('openai');
    expect(providerOfModel('DeepSeek/deepseek-v4.1-flash')).toBe('deepseek');
    expect(providerOfModel('auto')).toBeNull();
    expect(modelProviderOn({}, 'auto')).toBe(true);
    expect(modelProviderOn({}, 'deepseek/deepseek-v4.1-flash')).toBe(false);
    expect(modelProviderOn({ google: false }, 'google/gemini-4-argon')).toBe(false);
    expect(modelProviderOn({}, 'anthropic/claude-sonnet-5.5')).toBe(true);
  });

  it('read the kept choices leniently: known providers and booleans only', () => {
    expect(
      parseProviderChoices({ openai: false, deepseek: 'yes', mistralai: true, google: true }),
    ).toEqual({ openai: false, google: true });
    expect(parseProviderChoices(null)).toEqual({});
    expect(parseProviderChoices(['openai'])).toEqual({});
  });

  it('read the maker of an own key’s model, Azure as OpenAI', () => {
    expect(keyModelProvider('openrouter', 'deepseek/deepseek-v4.1-flash')).toBe('deepseek');
    expect(keyModelProvider('openrouter', '')).toBeNull();
    expect(keyModelProvider('azure', 'my-deployment')).toBe('openai');
    expect(keyModelProvider('openai', 'gpt-5.5')).toBe('openai');
    expect(keyModelProvider('google', 'gemini-3-pro')).toBe('google');
    expect(keyModelProvider('anthropic', 'claude-sonnet-5-5')).toBe('anthropic');
  });

  it('turn off every provider that can be, and only those, when choices can’t be read', () => {
    expect(MODEL_PROVIDERS.map((p) => providerOn(PROVIDERS_OFF, p.id))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
