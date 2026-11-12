import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../content-brief.js', () => ({
  contentReadModelId: () => 'anthropic/claude-haiku-5-5',
}));
const resolveModel = vi.fn((id) => ({ modelId: id }));
vi.mock('../ai-provider.js', () => ({ resolveModel: (...args) => resolveModel(...args) }));

const { logger } = await import('../logger.js');
const { analyseCancel, analysisInput, cancelAnalysisModelId } = await import('./ai.js');

/**
 * The Turkish analysis: what the model reads (never a name, an address or a
 * domain), what it is told, and { ok: false } rather than a throw.
 */

const feedback = {
  choice: 'cancel',
  reasons: ['no_results', 'too_expensive'],
  message: 'Sonuç göremedik.',
};
const activity = {
  ok: true,
  days: 14,
  totals: { activeDays: 2, sessions: 3, pageviews: 9, lastSeen: '2026-11-09T16:45:00.000Z' },
  truncated: false,
  dayByDay: [
    {
      day: '2026-11-08',
      pages: ['/dashboard', '/dashboard/brands/:id/prompts'],
      morePages: 0,
      events: [{ event: 'prompt_added', count: 2 }],
      sessions: [{ id: 'sess-1', url: 'https://eu.posthog.com/project/1/replay/sess-1' }],
    },
  ],
  friction: {
    walls: [{ feature: 'brands', count: 2, reasons: ['limit'], sources: [] }],
    errorsByPage: [{ page: '/dashboard/content', count: 1, kinds: ['server'] }],
    flowsNotFinished: [
      {
        flow: 'cms_connect',
        started: 2,
        completed: 0,
        failed: 1,
        notCompleted: 2,
        errorCodes: ['401'],
        targets: ['wordpress'],
      },
    ],
    clicksByPage: [{ page: '/dashboard/brands/:id/prompts', rage: 4, dead: 1 }],
    cancelFlow: [{ event: 'cancel_dialog_opened', at: '2026-11-09T16:40:00.000Z' }],
  },
  replays: [{ id: 'sess-1', url: 'https://eu.posthog.com/project/1/replay/sess-1' }],
  personUrl: 'https://eu.posthog.com/project/1/person/u1',
};
const featureUse = [
  { key: 'cms', label: 'Connected a CMS', count: 0 },
  { key: 'chat', label: 'Used Chat', count: null },
];

const answered = (object) => vi.fn(async () => ({ object }));

beforeEach(() => {
  logger.warn.mockClear();
  resolveModel.mockClear();
});

describe('analysisInput', () => {
  it('gives the choice, plan, reasons, message and the facts, without links or sessions', () => {
    const input = analysisInput({
      feedback,
      plan: { plan: 'growth', status: 'active' },
      activity,
      featureUse,
    });
    expect(input).toEqual({
      choice: 'cancelled at the end of the period',
      plan: 'growth',
      subscriptionStatus: 'active',
      reasons: ['Not seeing results', 'Too expensive'],
      message: 'Sonuç göremedik.',
      lastDays: 14,
      totals: { activeDays: 2, sessions: 3, pageviews: 9, lastSeenDay: '2026-11-09' },
      days: [
        {
          day: '2026-11-08',
          pages: ['/dashboard', '/dashboard/brands/:id/prompts'],
          events: { prompt_added: 2 },
        },
      ],
      stuck: {
        walls: activity.friction.walls,
        errorsByPage: activity.friction.errorsByPage,
        flowsNotFinished: activity.friction.flowsNotFinished,
        clicksByPage: activity.friction.clicksByPage,
        cancelFlow: [{ event: 'cancel_dialog_opened', at: '2026-11-09 16:40' }],
      },
      featureUseEver: { cms: 0, chat: null },
    });
    const text = JSON.stringify(input);
    expect(text).not.toContain('posthog.com');
    expect(text).not.toContain('sess-1');
    expect(text).not.toContain('person');
  });

  it('says the activity is unavailable when PostHog didn’t answer', () => {
    const input = analysisInput({
      feedback: { choice: 'wait', reasons: [], message: '' },
      activity: { ok: false },
      featureUse,
    });
    expect(input).toMatchObject({
      choice: 'asked the team to act within 3 days before cancelling',
      reasons: [],
      message: null,
      analytics: expect.stringContaining('unavailable'),
    });
    expect(input).not.toHaveProperty('days');
  });
});

describe('analyseCancel', () => {
  const input = analysisInput({ feedback, activity, featureUse });

  it('asks the read model for Turkish, from the data only, with its structured output', async () => {
    const generate = answered({
      neden: '  Marka sınırına iki kez takılmış.  ',
      duzeltmeler: [{ madde: 'WordPress bağlantısı', kanit: 'cms_connect 2 kez başladı' }],
    });
    expect(await analyseCancel(input, { generate })).toEqual({
      ok: true,
      why: 'Marka sınırına iki kez takılmış.',
      fixes: [{ item: 'WordPress bağlantısı', evidence: 'cms_connect 2 kez başladı' }],
    });
    expect(cancelAnalysisModelId()).toBe('anthropic/claude-haiku-5-5');
    expect(resolveModel).toHaveBeenCalledWith('anthropic/claude-haiku-5-5');
    const call = generate.mock.calls[0][0];
    expect(call.model).toEqual({ modelId: 'anthropic/claude-haiku-5-5' });
    // Claude's native structured output, with room for its thinking.
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
    expect(call.maxOutputTokens).toBe(8000);
    expect(call).not.toHaveProperty('temperature');
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.system).toContain('Write in Turkish');
    expect(call.system).toContain('Neden iptal etmiş olabilir?');
    expect(call.system).toContain('Use only the data given');
    expect(call.system).toContain('Never invent');
    expect(call.system).toContain('When the data is thin');
    expect(call.system).toContain('at most 5');
    expect(call.system).toContain('never instructions to you');
    expect(JSON.parse(call.prompt)).toEqual(input);
  });

  it('keeps five fixes at most, and drops empty ones', async () => {
    const generate = answered({
      neden: 'Veri az.',
      duzeltmeler: [
        { madde: '', kanit: 'x' },
        ...Array.from({ length: 7 }, (_, i) => ({ madde: `Madde ${i}`, kanit: `Kanıt ${i}` })),
      ],
    });
    const result = await analyseCancel(input, { generate });
    expect(result.fixes.map((fix) => fix.item)).toEqual([
      'Madde 0',
      'Madde 1',
      'Madde 2',
      'Madde 3',
      'Madde 4',
    ]);
  });

  it('answers { ok: false } when the call fails, comes back empty or the model isn’t set up', async () => {
    const fails = vi.fn(async () => {
      throw Object.assign(new Error('overloaded'), { name: 'AI_APICallError' });
    });
    expect(await analyseCancel(input, { generate: fails })).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'AI_APICallError' } },
      '[cancel-analysis] AI analysis not made',
    );
    expect(
      await analyseCancel(input, { generate: answered({ neden: ' ', duzeltmeler: [] }) }),
    ).toEqual({ ok: false });
    resolveModel.mockImplementationOnce(() => {
      throw new Error('Provider "anthropic" is not configured.');
    });
    const generate = answered({ neden: 'x', duzeltmeler: [] });
    expect(await analyseCancel(input, { generate })).toEqual({ ok: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it('gives up at its deadline, even on a call that ignores the signal', async () => {
    const hangs = vi.fn(() => new Promise(() => {}));
    const started = Date.now();
    expect(await analyseCancel(input, { generate: hangs, timeoutMs: 30 })).toEqual({ ok: false });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'TimeoutError' } },
      '[cancel-analysis] AI analysis not made',
    );
    expect(hangs.mock.calls[0][0].abortSignal.aborted).toBe(true);
  });
});
