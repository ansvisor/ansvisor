import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const {
  PRIVACY_URL,
  MAX_PDF_ATTEMPTS,
  deliverReportCards,
  pdfName,
  renderCardPdf,
  renderFailedEmail,
  renderReportCardEmail,
  signUpUrl,
} = await import('./deliver.js');

/** The card's e-mail: what it says, the PDF attached, and each request sent once. */

const payload = {
  companyName: 'Acme <Coffee>',
  domain: 'acme.example',
  country: { code: 'US', name: 'United States' },
  language: 'English',
  questionCount: 25,
  engines: [
    { engine: 'chatgpt-web', answers: 25, named: 7 },
    { engine: 'gemini-web', answers: 25, named: 4 },
    { engine: 'google-aio', answers: 20, named: 5 },
    { engine: 'google-aimode', answers: 25, named: 2 },
  ],
  competitors: [{ name: 'Ridge & Co', answers: 41 }],
  ownCitations: 4,
};

describe('renderReportCardEmail', () => {
  it('says what came back, invites a trial and says the PDF is attached', () => {
    const { subject, html } = renderReportCardEmail({
      firstName: 'Ayşe',
      payload,
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
      origin: 'https://app.ansvisor.com',
    });
    expect(subject).toBe('Your AI visibility report card: acme.example');
    expect(html).toContain('Hi Ayşe,');
    expect(html).toContain(
      'We asked ChatGPT, Gemini, Google AI Overviews and Google AI Mode 25 questions your buyers ask, in the United States.',
    );
    expect(html).toContain('19%');
    expect(html).toContain('named in 18 of 95 answers');
    expect(html).toContain('Ridge &amp; Co');
    expect(html).toContain('attached as a PDF, 4 pages');
    expect(html).toContain('and all 25 questions we asked');
    expect(html).toContain('border-radius:100px');
    expect(html).not.toMatch(/#111827|#6b7280|#6366f1/);
    expect(html).toContain(
      'href="https://app.ansvisor.com/en/sign-up?utm_source=report-card&amp;utm_medium=email"',
    );
    expect(html).toContain(PRIVACY_URL);
    expect(html).not.toMatch(/guarantee/i);
  });

  it('speaks of a publisher’s readers', () => {
    const { html } = renderReportCardEmail({
      firstName: 'Ayşe',
      payload: { ...payload, audience: 'readers' },
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
    });
    expect(html).toContain('25 questions your readers ask');
  });

  it('says when a card sent again was made, and when a new one can be', () => {
    const { html } = renderReportCardEmail({
      firstName: 'Mehmet',
      payload,
      kind: 'resent',
      madeAt: '2026-10-20T10:00:00Z',
      origin: 'https://app.ansvisor.com',
    });
    expect(html).toContain(
      'we made it on Oct 20, 2026, and a new one can be made from Nov 19, 2026.',
    );
  });

  it('escapes what the person and the answers gave', () => {
    const { html } = renderReportCardEmail({
      firstName: '<script>x</script>',
      payload: { ...payload, competitors: [] },
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('No competitor was named');
  });

  it('writes a short note for a card that couldn’t be made', () => {
    const { subject, html } = renderFailedEmail({ firstName: 'Ayşe', site: 'acme.example' });
    expect(subject).toBe('We couldn’t finish your report card for acme.example');
    expect(html).toContain('Reply to this e-mail');
  });
});

describe('names and links', () => {
  it('names the PDF after the site, and links the trial from the app’s origin', () => {
    expect(pdfName('acme.example')).toBe('ansvisor-ai-visibility-report-card-acme.example.pdf');
    expect(signUpUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/en/sign-up?utm_source=report-card&utm_medium=email',
    );
  });
});

describe('renderCardPdf', () => {
  it('asks the web app with the internal secret', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([37, 80]).buffer,
    }));
    const pdf = await renderCardPdf(payload, { fetchImpl, env: { CRON_SECRET: 's3' } });
    expect([...pdf]).toEqual([37, 80]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/report-card\/pdf$/);
    expect(init.headers.Authorization).toBe('Bearer s3');
    expect(JSON.parse(init.body)).toEqual({ card: payload });
  });

  it('throws without the secret, and with the status the web refused with', async () => {
    await expect(renderCardPdf(payload, { fetchImpl: vi.fn(), env: {} })).rejects.toThrow(
      'CRON_SECRET',
    );
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422 }));
    await expect(
      renderCardPdf(payload, { fetchImpl, env: { CRON_SECRET: 's' } }),
    ).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe('deliverReportCards', () => {
  const request = (id, card, outcome = 'queued') => ({
    id,
    first_name: 'Ayşe',
    email: `${id}@acme.example`,
    outcome,
    report_cards: card,
  });
  const ready = {
    id: 'c1',
    status: 'ready',
    payload,
    site: 'acme.example',
    created_at: '2026-11-03T10:00:00Z',
  };
  const failed = {
    id: 'c2',
    status: 'failed',
    payload: null,
    site: 'other.example',
    created_at: '2026-11-03T10:00:00Z',
  };
  const NOW = new Date('2026-11-03T10:05:00Z');

  function store(rows) {
    return {
      undeliveredRequests: vi.fn(async () => rows),
      markEmailed: vi.fn(async () => {}),
      markEmailAttempt: vi.fn(async () => {}),
    };
  }

  it('sends each request once, the card’s PDF drawn once and attached', async () => {
    const s = store([request('r1', ready), request('r2', ready, 'resent'), request('r3', failed)]);
    const render = vi.fn(async () => Buffer.from('%PDF'));
    const send = vi.fn(async () => 'sent');
    const sent = await deliverReportCards({
      store: s,
      render,
      send,
      now: () => NOW,
      env: {
        REPORT_CARD_FROM_EMAIL: 'Ansvisor <reports@ansvisor.com>',
        REPORT_CARD_REPLY_TO: 'hello@ansvisor.com',
      },
    });
    expect(sent).toBe(3);
    expect(render).toHaveBeenCalledTimes(1);
    const [first, second, third] = send.mock.calls.map(([message]) => message);
    expect(first).toMatchObject({
      to: ['r1@acme.example'],
      from: 'Ansvisor <reports@ansvisor.com>',
      replyTo: 'hello@ansvisor.com',
      attachments: [
        { filename: 'ansvisor-ai-visibility-report-card-acme.example.pdf', content: 'JVBERg==' },
      ],
    });
    expect(second.html).toContain('report card again');
    expect(third.subject).toBe('We couldn’t finish your report card for other.example');
    expect(third).not.toHaveProperty('attachments');
    expect(s.markEmailed.mock.calls).toEqual([
      ['r1', 'sent', NOW],
      ['r2', 'sent', NOW],
      ['r3', 'sent', NOW],
    ]);
  });

  it('marks what Resend said, sent or not, so nothing goes twice', async () => {
    const s = store([request('r1', ready)]);
    await deliverReportCards({
      store: s,
      render: async () => Buffer.from('x'),
      send: async () => 'unknown',
      now: () => NOW,
      env: {},
    });
    expect(s.markEmailed).toHaveBeenCalledWith('r1', 'unknown', NOW);
  });

  it('waits for the next sweep when the web can’t draw the PDF, and gives up on one it refuses', async () => {
    const down = store([request('r1', ready)]);
    const send = vi.fn();
    await deliverReportCards({
      store: down,
      render: async () => {
        throw new Error('ECONNREFUSED');
      },
      send,
      now: () => NOW,
      env: {},
    });
    expect(down.markEmailed).not.toHaveBeenCalled();
    expect(down.markEmailAttempt).toHaveBeenCalledWith('r1', 1);
    const refused = store([request('r1', ready)]);
    await deliverReportCards({
      store: refused,
      render: async () => {
        throw Object.assign(new Error('refused'), { status: 422 });
      },
      send,
      now: () => NOW,
      env: {},
    });
    expect(refused.markEmailed).toHaveBeenCalledWith('r1', 'refused', NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it('tries again after a 401, a 404 or a 5xx, and gives up after MAX_PDF_ATTEMPTS', async () => {
    for (const status of [401, 404, 503]) {
      const s = store([{ ...request('r1', ready), email_attempts: 3 }]);
      await deliverReportCards({
        store: s,
        render: async () => {
          throw Object.assign(new Error('no'), { status });
        },
        send: vi.fn(),
        now: () => NOW,
        env: {},
      });
      expect(s.markEmailed).not.toHaveBeenCalled();
      expect(s.markEmailAttempt).toHaveBeenCalledWith('r1', 4);
    }
    const last = store([{ ...request('r1', ready), email_attempts: MAX_PDF_ATTEMPTS - 1 }]);
    await deliverReportCards({
      store: last,
      render: async () => {
        throw Object.assign(new Error('no'), { status: 500 });
      },
      send: vi.fn(),
      now: () => NOW,
      env: {},
    });
    expect(last.markEmailed).toHaveBeenCalledWith('r1', 'refused', NOW);
  });
});
