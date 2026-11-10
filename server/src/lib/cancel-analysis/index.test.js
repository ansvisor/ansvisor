import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../content-brief.js', () => ({
  contentReadModelId: () => 'anthropic/claude-haiku-5-5',
}));
vi.mock('../ai-provider.js', () => ({ resolveModel: (id) => ({ modelId: id }) }));
const deliverEmail = vi.fn();
vi.mock('../email.js', () => ({ deliverEmail: (...args) => deliverEmail(...args) }));

const { logger } = await import('../logger.js');
const { cancelAnalysisConfigured, sendCancelAnalysis, threadMessageId } =
  await import('./index.js');

/**
 * The follow-up as a whole: read, analysed and sent in the first e-mail's
 * thread; nothing read without the team's addresses and PostHog; whatever
 * fails is a line in the e-mail or a log, never a throw.
 */

const USER = '5f0c6a8e-1b2d-4c3e-9f4a-0123456789ab';
const BRAND = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SESSION = '019a6b2c-1111-7000-8000-000000000001';
const MESSAGE_ID = '<cancel-feedback-f1@mail.example>';

// The customer, as the first e-mail knows them: none of it may reach the model.
const CUSTOMER = { org: 'Acme Coffee', name: 'Ada Lovelace', email: 'ada@acme.example' };

const input = (overrides = {}) => ({
  orgId: 'o1',
  userId: USER,
  plan: { plan: 'growth', status: 'active' },
  feedback: { choice: 'cancel', reasons: ['no_results'], message: 'Sonuç göremedik.' },
  subject: `${CUSTOMER.org} cancelled their plan`,
  messageId: MESSAGE_ID,
  recipients: ['team-a', 'team-b'],
  ...overrides,
});

const answer = (columns, results) => ({
  ok: true,
  status: 200,
  json: async () => ({ columns, results }),
});

/** PostHog's three answers: a day on the prompts page, a failed CMS connect, rage clicks. */
const posthog = () =>
  vi.fn(async (_url, init) => {
    const { name } = JSON.parse(init.body);
    if (name.endsWith('pageviews')) {
      return answer(
        ['timestamp', 'pathname', 'sid'],
        [
          ['2026-11-09T10:05:00Z', `/en/dashboard/brands/${BRAND}/prompts`, SESSION],
          ['2026-11-09T10:00:00Z', '/dashboard', SESSION],
        ],
      );
    }
    if (name.endsWith('events')) {
      return answer(
        ['event', 'timestamp', 'pathname', 'sid', 'flow', 'target', 'error_code'],
        [
          [
            'flow_failed',
            '2026-11-09T10:04:00Z',
            '/dashboard/settings',
            SESSION,
            'cms_connect',
            'acme.example',
            'auth_failed',
          ],
          [
            'flow_started',
            '2026-11-09T10:03:00Z',
            '/dashboard/settings',
            SESSION,
            'cms_connect',
            'acme.example',
            null,
          ],
        ],
      );
    }
    return answer(
      ['url', 'sid', 'type', 'n', 'first_at'],
      [
        [
          `https://app.ansvisor.com/dashboard/brands/${BRAND}/prompts`,
          SESSION,
          'rageclick',
          4,
          '2026-11-09T10:06:00Z',
        ],
      ],
    );
  });

/** A service-role client: one real brand, and a count for every feature. */
const db = {
  from: (table) => {
    const result =
      table === 'brands'
        ? { data: [{ id: 'b1' }], error: null }
        : { count: table === 'competitors' ? 3 : 0, error: null };
    const chain = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === 'then'
            ? (resolve, reject) => Promise.resolve(result).then(resolve, reject)
            : () => chain,
      },
    );
    return chain;
  },
};

const generated = () =>
  vi.fn(async () => ({
    object: {
      neden: 'WordPress bağlantısı başarısız olmuş ve prompts sayfasında takılmış.',
      duzeltmeler: [{ madde: 'CMS bağlantı hatası', kanit: '2026-11-09 cms_connect auth_failed' }],
    },
  }));

const options = ({ fetcher = posthog(), generate = generated() } = {}) => ({
  posthog: { fetcher, appHost: 'https://eu.posthog.com' },
  db,
  ai: { generate },
});

beforeEach(() => {
  vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test');
  vi.stubEnv('POSTHOG_PROJECT_ID', '12345');
  deliverEmail.mockReset().mockResolvedValue('sent');
  logger.warn.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendCancelAnalysis', () => {
  it('sends the analysis in the first e-mail’s thread, to the team only', async () => {
    const opts = options();
    expect(await sendCancelAnalysis(input(), opts)).toBe('sent');
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    const mail = deliverEmail.mock.calls[0][0];
    expect(mail.to).toEqual(['team-a', 'team-b']);
    expect(mail.subject).toBe('Re: Acme Coffee cancelled their plan');
    expect(mail.headers).toEqual({ 'In-Reply-To': MESSAGE_ID, References: MESSAGE_ID });
    // A reply goes to the sender, never to the customer.
    expect(mail).not.toHaveProperty('replyTo');
    expect(mail.html).toContain('Neden iptal etmiş olabilir?');
    expect(mail.html).toContain('WordPress bağlantısı başarısız olmuş');
    expect(mail.html).toContain('/dashboard → /dashboard/brands/:id/prompts');
    expect(mail.html).toContain('started 1 · completed 0 · failed 1 · codes auth_failed');
    expect(mail.html).toContain(`https://eu.posthog.com/project/12345/replay/${SESSION}`);
    expect(mail.html).toMatch(/>Connected a CMS<\/td><td[^>]*>Never<\/td>/);
    expect(mail.html).toMatch(/>Added competitors<\/td><td[^>]*>Yes \(3\)<\/td>/);
    expect(mail.html).toContain(`https://eu.posthog.com/project/12345/person/${USER}`);
  });

  it('sends the model no name, address, domain, link or session of the customer', async () => {
    const generate = generated();
    await sendCancelAnalysis(input(), options({ generate }));
    expect(generate).toHaveBeenCalledTimes(1);
    const { system, prompt } = generate.mock.calls[0][0];
    const sent = `${system}\n${prompt}`;
    for (const secret of [
      CUSTOMER.org,
      CUSTOMER.name,
      CUSTOMER.email,
      'acme.example',
      'Acme',
      USER,
      BRAND,
      SESSION,
      'posthog.com',
      'https://',
    ]) {
      expect(sent).not.toContain(secret);
    }
    // What it does get: the reasons, the message, normalised paths and event names.
    const facts = JSON.parse(prompt);
    expect(facts.reasons).toEqual(['Not seeing results']);
    expect(facts.message).toBe('Sonuç göremedik.');
    expect(facts.days[0].pages).toEqual(['/dashboard', '/dashboard/brands/:id/prompts']);
    expect(facts.days[0].events).toEqual({ flow_started: 1, flow_failed: 1 });
    expect(facts.stuck.clicksByPage).toEqual([
      { page: '/dashboard/brands/:id/prompts', rage: 4, dead: 0 },
    ]);
  });

  it('still sends the analysis when PostHog fails, saying so, from what is left', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const generate = generated();
    expect(await sendCancelAnalysis(input(), options({ fetcher, generate }))).toBe('sent');
    const { html } = deliverEmail.mock.calls[0][0];
    expect(html).toContain("PostHog didn't answer, so there is no activity.");
    expect(html).toContain('Not used');
    // The model is told there is no activity rather than given none.
    expect(JSON.parse(generate.mock.calls[0][0].prompt).analytics).toContain('unavailable');
  });

  it('still sends the data when the AI fails, saying so in one line', async () => {
    const generate = vi.fn(async () => {
      throw new Error('overloaded');
    });
    expect(await sendCancelAnalysis(input(), options({ generate }))).toBe('sent');
    const { html } = deliverEmail.mock.calls[0][0];
    expect(html).toContain(
      "The AI analysis didn't come back, so this e-mail has only the data below.",
    );
    expect(html).toContain('Where they got stuck');
  });

  it('reads nothing without the team’s addresses or PostHog', async () => {
    for (const [env, over] of [
      [{}, { recipients: [] }],
      [{ POSTHOG_PERSONAL_API_KEY: '' }, {}],
      [{ POSTHOG_PROJECT_ID: '' }, {}],
    ]) {
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      const fetcher = posthog();
      const generate = generated();
      const from = vi.fn(db.from);
      expect(
        await sendCancelAnalysis(input(over), { ...options({ fetcher, generate }), db: { from } }),
      ).toBe('skipped');
      expect(fetcher).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(deliverEmail).not.toHaveBeenCalled();
      vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test');
      vi.stubEnv('POSTHOG_PROJECT_ID', '12345');
    }
  });

  it('never throws: a failed send is logged', async () => {
    deliverEmail.mockRejectedValue(new TypeError('boom'));
    expect(await sendCancelAnalysis(input(), options())).toBe('failed');
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'TypeError' } },
      '[cancel-analysis] follow-up failed',
    );
    deliverEmail.mockResolvedValue('refused');
    expect(await sendCancelAnalysis(input(), options())).toBe('refused');
    expect(logger.warn).toHaveBeenCalledWith(
      { status: 'refused' },
      '[cancel-analysis] follow-up not e-mailed',
    );
  });

  it('goes without threading headers when there is no Message-ID to answer', async () => {
    await sendCancelAnalysis(input({ messageId: null }), options());
    const mail = deliverEmail.mock.calls[0][0];
    expect(mail.subject).toBe('Re: Acme Coffee cancelled their plan');
    expect(mail).not.toHaveProperty('headers');
  });
});

describe('threadMessageId', () => {
  it('is unique to the answer kept, on the sender’s domain', () => {
    expect(threadMessageId('f1', 'Ansvisor <hello@mail.example>')).toBe(
      '<cancel-feedback-f1@mail.example>',
    );
    expect(threadMessageId('0f1e2d3c-4b5a', 'team@mail.example')).toBe(
      '<cancel-feedback-0f1e2d3c-4b5a@mail.example>',
    );
    expect(threadMessageId('f1<>"', undefined)).toBe('<cancel-feedback-f1@ansvisor.invalid>');
  });
});

describe('cancelAnalysisConfigured', () => {
  it('is PostHog’s key and project', () => {
    expect(cancelAnalysisConfigured()).toBe(true);
    expect(cancelAnalysisConfigured({ POSTHOG_PROJECT_ID: '1' })).toBe(false);
  });
});
