import { describe, expect, it } from 'vitest';
import { openRouterRouting } from '@/lib/agent/openrouter';
import { CHAT_MODELS } from './models';

/** The models Chat may run once tested (W4-35). */

describe('CHAT_MODELS', () => {
  it('tests no model whose hosts Ansvisor limits until the AI budget prices it at theirs (W4-36)', () => {
    // DeepSeek runs only on US and EU hosts (W4-34), dearer than the catalog's price, which is
    // its cheapest provider's: on that price the budget would count less than it costs.
    const limited = CHAT_MODELS.filter((model) => openRouterRouting(model.id).only);
    expect(limited.map((model) => model.id)).toContain('deepseek/deepseek-v4.1-flash');
    expect(limited.filter((model) => model.tested)).toEqual([]);
  });
});
