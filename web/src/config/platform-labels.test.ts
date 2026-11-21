import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_NAMES, PLATFORM_LABELS, platformLabel } from './platform-labels';

/** One name per engine, here and on the server (GL-05, D10). */

describe('the engine names', () => {
  it('names Gemini "Gemini", and an API-model platform with the API suffix', () => {
    expect(platformLabel('gemini-web')).toBe('Gemini');
    expect(platformLabel('chatgpt-web')).toBe('ChatGPT');
    expect(platformLabel('chatgpt')).toBe('ChatGPT API');
    expect(platformLabel('gemini')).toBe('Gemini API');
    expect(platformLabel('claude')).toBe('Claude API');
  });

  it('keeps an id it does not know', () => {
    expect(platformLabel('new-engine')).toBe('new-engine');
  });

  it('keeps every engine in the platform map', () => {
    for (const [id, name] of Object.entries(ENGINE_NAMES)) {
      expect(PLATFORM_LABELS[id], id).toBe(name);
    }
  });

  it('is the same list as the server copy', () => {
    const server = JSON.parse(
      readFileSync(join(__dirname, '../../../server/src/config/engine-names.json'), 'utf8'),
    ) as Record<string, string>;
    expect(server).toEqual(ENGINE_NAMES);
  });
});
