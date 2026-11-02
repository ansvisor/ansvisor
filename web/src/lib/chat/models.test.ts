// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEEPSEEK_US_EU_PROVIDERS, openRouterRouting } from '@/lib/agent/openrouter';
import { CHAT_MODELS } from './models';

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
});
