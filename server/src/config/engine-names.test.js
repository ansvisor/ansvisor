import { describe, expect, it } from 'vitest';
import { ENGINE_NAMES, engineName } from './engine-names.js';

describe('engineName', () => {
  it('names an engine by its display name, never its id', () => {
    expect(engineName('gemini-web')).toBe('Gemini');
    expect(engineName('chatgpt-web')).toBe('ChatGPT');
    expect(engineName('google-aio')).toBe('Google AI Overviews');
  });

  it('gives an API-model platform the API suffix', () => {
    expect(engineName('chatgpt')).toBe('ChatGPT API');
    expect(engineName('claude')).toBe('Claude API');
  });

  it('keeps an id it does not know', () => {
    expect(engineName('new-engine')).toBe('new-engine');
    expect(engineName('toString')).toBe('toString');
  });

  it('cannot be changed', () => {
    expect(Object.isFrozen(ENGINE_NAMES)).toBe(true);
  });
});
