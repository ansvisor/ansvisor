// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

/** Auto (CHAT-16 item 5): Claude Haiku 5.5 reads, Claude Sonnet 5.5 writes; Claude 5.5's settings. */

const key = vi.hoisted(() => ({
  resolve: vi.fn(),
  picked: vi.fn(),
  failure: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock('./key', () => ({
  resolveChatModelKey: key.resolve,
  resolvePickedModelKey: key.picked,
}));
vi.mock('./key-health', () => ({ ownKeyFailure: key.failure }));

const {
  autoModels,
  claudeEffort,
  estimateInputTokens,
  openRouterModels,
  pickedClaudeModels,
  resolveChatModels,
} = await import('./engine-model');
const { OFFERED_MODELS } = await import('./models');

const modelId = (choice: { model: unknown }) => (choice.model as { modelId: string }).modelId;

describe('the run models', () => {
  it('read with Haiku 5.5 and write with Sonnet 5.5, priced by their catalog ids', () => {
    const models = autoModels('test-key', 'ansvisor');
    const read = models.pick('read');
    const write = models.pick('write');
    expect(models.phases).toBe('auto');
    expect((read.model as { modelId: string }).modelId).toBe('claude-haiku-5-5');
    expect((write.model as { modelId: string }).modelId).toBe('claude-sonnet-5-5');
    expect(read.budgetModel).toBe('anthropic/claude-haiku-5.5');
    expect(write.budgetModel).toBe('anthropic/claude-sonnet-5.5');
    expect(read.maxOutputTokens).toBe(8_000);
    expect(write.maxOutputTokens).toBe(16_000);
    // Native structured output, never the SDK's forced "json" tool; no sampling settings.
    expect(read.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
  });

  it('follow the key: Auto on an Anthropic key, one model on another provider’s', async () => {
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    expect((await resolveChatModels('org'))?.phases).toBe('auto');
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'openai', apiKey: 'k', settings: {} },
    });
    const single = await resolveChatModels('org');
    expect(single?.phases).toBe('single');
    expect(single?.pick('read').budgetModel).toBe('openai/gpt-5.5');
    key.resolve.mockResolvedValueOnce(null);
    expect(await resolveChatModels('org')).toBeNull();
  });

  it('carry the key’s provider, and on the own key whether it was failing as the run started', async () => {
    key.failure.mockResolvedValueOnce({ provider: 'openai', class: 'no_credit' });
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'openai', apiKey: 'k', settings: {} },
    });
    expect(await resolveChatModels('org')).toMatchObject({ provider: 'openai', keyFailing: true });

    // A health read that fails reads as working; Ansvisor's key is never read for it.
    key.failure.mockRejectedValueOnce(new Error('down'));
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    expect(await resolveChatModels('org')).toMatchObject({
      provider: 'anthropic',
      keyFailing: false,
    });
    key.failure.mockClear();
    key.resolve.mockResolvedValueOnce({
      source: 'ansvisor',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    expect(await resolveChatModels('org')).toMatchObject({ source: 'ansvisor', keyFailing: false });
    expect(key.failure).not.toHaveBeenCalled();
  });

  it('run a Claude model picked in the menu for both phases, priced by its catalog id (W4-03)', () => {
    const sonnet = OFFERED_MODELS.find((m) => m.id === 'anthropic/claude-sonnet-5.5')!;
    const models = pickedClaudeModels('k', 'ansvisor', sonnet);
    expect(models.phases).toBe('auto');
    expect(models.model).toBe('anthropic/claude-sonnet-5.5');
    for (const phase of ['read', 'write'] as const) {
      expect(modelId(models.pick(phase))).toBe('claude-sonnet-5-5');
      expect(models.pick(phase).budgetModel).toBe('anthropic/claude-sonnet-5.5');
      expect(models.pick(phase).claude).toBe(true);
    }
    expect(models.pick('read').maxOutputTokens).toBe(8_000);
  });

  it('turn effort into Claude’s own setting, with more room to write (W4-03)', () => {
    expect(claudeEffort('claude-haiku-5-5', 'normal')).toBeUndefined();
    expect(claudeEffort('claude-haiku-5-5', 'high')).toBe('high');
    expect(claudeEffort('claude-opus-5-5', 'high')).toBe('high');
    // Sonnet 5.5 is at high already: one level up.
    expect(claudeEffort('claude-sonnet-5-5', 'high')).toBe('xhigh');
    expect(claudeEffort('claude-sonnet-5-5', 'max')).toBe('max');

    const high = autoModels('k', 'ansvisor', 'high');
    expect(high.pick('read').providerOptions).toEqual({
      anthropic: { structuredOutputMode: 'outputFormat', effort: 'high' },
    });
    expect(high.pick('write').providerOptions).toEqual({
      anthropic: { structuredOutputMode: 'outputFormat', effort: 'xhigh' },
    });
    expect(high.pick('write').maxOutputTokens).toBe(24_000);
    const max = autoModels('k', 'ansvisor', 'max');
    expect(max.pick('read').maxOutputTokens).toBe(16_000);
    expect(max.pick('write').maxOutputTokens).toBe(32_000);
  });

  it('run a pick on its provider’s key, Auto for a model not offered (W4-03, W4-06)', async () => {
    key.picked.mockResolvedValueOnce({
      source: 'ansvisor',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    const sonnet = await resolveChatModels('org', {
      model: 'anthropic/claude-sonnet-5.5',
      effort: 'max',
    });
    expect(key.picked).toHaveBeenCalledWith('org', 'anthropic', { ansvisorOnly: false });
    expect(sonnet?.model).toBe('anthropic/claude-sonnet-5.5');
    expect(modelId(sonnet!.pick('read'))).toBe('claude-sonnet-5-5');
    expect(sonnet?.pick('write').providerOptions).toMatchObject({ anthropic: { effort: 'max' } });

    // Not offered (not tested, or never listed): no picked key is looked for, the run takes Auto.
    key.picked.mockClear();
    key.resolve.mockResolvedValueOnce({
      source: 'ansvisor',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    const opus = await resolveChatModels('org', {
      model: 'mistralai/mistral-large-3',
      effort: 'max',
    });
    expect(key.picked).not.toHaveBeenCalled();
    expect(opus?.model).toBe('auto');
    expect(modelId(opus!.pick('write'))).toBe('claude-sonnet-5-5');

    key.resolve.mockResolvedValueOnce({
      source: 'ansvisor',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    const unknown = await resolveChatModels('org', {
      model: 'openai/gpt-6.1-sol',
      effort: 'normal',
    });
    expect(unknown?.model).toBe('auto');
    expect(modelId(unknown!.pick('read'))).toBe('claude-haiku-5-5');
  });

  it('run a Claude pick through the own OpenRouter key by its catalog id (W4-06)', async () => {
    key.picked.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'openrouter', apiKey: 'or', settings: { model: 'x/y' } },
    });
    key.failure.mockResolvedValueOnce({ provider: 'openrouter', class: 'no_credit' });
    const models = await resolveChatModels('org', {
      model: 'anthropic/claude-sonnet-5.5',
      effort: 'normal',
    });
    expect(models).toMatchObject({
      source: 'own',
      provider: 'openrouter',
      phases: 'single',
      model: 'anthropic/claude-sonnet-5.5',
      keyFailing: true,
    });
    expect(modelId(models!.pick('write'))).toBe('anthropic/claude-sonnet-5.5');
    expect(models!.pick('write').budgetModel).toBe('anthropic/claude-sonnet-5.5');
  });

  it('pass "Use Ansvisor’s limit" on to the key, for Auto too (W4-06)', async () => {
    key.resolve.mockResolvedValueOnce({
      source: 'ansvisor',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    await resolveChatModels('org', { model: 'auto', effort: 'normal' }, { ansvisorOnly: true });
    expect(key.resolve).toHaveBeenLastCalledWith('org', { ansvisorOnly: true });
  });

  it('run a model through OpenRouter in one phase, with its reasoning effort (W4-03)', () => {
    const picked = {
      id: 'x-ai/grok-4.7',
      api: 'x-ai/grok-4.7',
      provider: 'openrouter' as const,
      label: 'Grok 4.7',
      tested: true,
    };
    const models = openRouterModels('or-key', picked, 'high');
    expect(models).toMatchObject({
      source: 'ansvisor',
      provider: 'openrouter',
      phases: 'single',
      model: 'x-ai/grok-4.7',
    });
    const step = models.pick('write');
    expect(step.budgetModel).toBe('x-ai/grok-4.7');
    expect(step.claude).toBe(false);
    expect(step.providerOptions).toMatchObject({
      openai: { store: false, reasoningEffort: 'high' },
    });
    expect(openRouterModels('or-key', picked).pick('read').providerOptions).not.toHaveProperty(
      'openai.reasoningEffort',
    );
  });

  it('count a prompt’s tokens up, not down', () => {
    expect(estimateInputTokens(['abcdef', { a: 1 }])).toBe(Math.ceil((6 + 7) / 3));
  });
});
