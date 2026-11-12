import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const {
  PRIVACY_URL,
  MAX_PDF_ATTEMPTS,
  deliverReportCards,
  emailCopy,
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
  it('says first that the PDF is attached, then what came back, and invites a trial', () => {
    const { subject, html } = renderReportCardEmail({
      firstName: 'Ayşe',
      payload,
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
      origin: 'https://app.ansvisor.com',
    });
    expect(subject).toBe('Your AI visibility report card: acme.example');
    expect(html).toContain('Hi Ayşe,');
    // Right after the greeting: the card is attached, said once.
    const attached = 'Your AI visibility report card for acme.example is attached: a 4-page PDF.';
    expect(html).toContain(attached);
    expect(html.indexOf('Hi Ayşe,')).toBeLessThan(html.indexOf(attached));
    expect(html.indexOf(attached)).toBeLessThan(html.indexOf('We asked'));
    expect(html.match(/attached/g)).toHaveLength(1);
    expect(html).toContain(
      'We asked ChatGPT, Gemini, Google AI Overviews and Google AI Mode 25 questions your buyers ask, in the United States.',
    );
    expect(html).toContain('19%');
    expect(html).toContain('named in 18 of 95 answers');
    expect(html).toContain('Ridge &amp; Co');
    expect(html).toContain('The 4 pages hold where you start');
    expect(html).toContain('all 25 questions we asked and what each engine said');
    expect(html).toContain('with Starter and Growth side by side.');
    expect(html).toContain(
      'In Ansvisor, Chat and ready-to-use agents do the week-one work with you.',
    );
    expect(html).toContain('Want to measure your own questions too?');
    expect(html).toContain('border-radius:100px');
    expect(html).not.toMatch(/#111827|#6b7280|#6366f1/);
    expect(html).toContain(
      'href="https://app.ansvisor.com/en/sign-up?utm_source=report-card&amp;utm_medium=email"',
    );
    expect(html).toContain(PRIVACY_URL);
    expect(html).not.toMatch(/guarantee/i);
  });

  it('heads with Starter’s engines and names Growth’s apart', () => {
    const { html } = renderReportCardEmail({
      firstName: 'Ayşe',
      payload: {
        ...payload,
        questionCount: 20,
        mainEngines: ['chatgpt-web', 'copilot-web'],
        engines: [
          { engine: 'chatgpt-web', answers: 20, named: 3 },
          { engine: 'copilot-web', answers: 20, named: 1 },
          { engine: 'gemini-web', answers: 20, named: 9 },
          { engine: 'google-aio', answers: 15, named: 5 },
        ],
      },
      kind: 'new',
      madeAt: '2026-11-04T10:00:00Z',
    });
    expect(html).toContain(
      'We asked ChatGPT and Microsoft Copilot, the engines in Ansvisor Starter, 20 questions your buyers ask, in the United States.',
    );
    expect(html).toContain(
      'We asked Gemini and Google AI Overviews too: they are in Ansvisor Growth, and the PDF shows them apart.',
    );
    expect(html).toContain('10%');
    expect(html).toContain(
      'AI visibility in ChatGPT and Microsoft Copilot: named in 4 of 40 answers',
    );
  });

  it('writes a Turkish card’s e-mail in Turkish', () => {
    const { subject, html } = renderReportCardEmail({
      firstName: 'Ayşe',
      payload: {
        ...payload,
        domain: 'turadahil.com',
        country: { code: 'TR', name: 'Türkiye' },
        questionCount: 25,
        mainEngines: ['chatgpt-web', 'copilot-web'],
        engines: [
          { engine: 'chatgpt-web', answers: 25, named: 0 },
          { engine: 'copilot-web', answers: 25, named: 0 },
          { engine: 'gemini-web', answers: 25, named: 0 },
        ],
      },
      kind: 'new',
      madeAt: '2026-11-04T10:00:00Z',
    });
    expect(subject).toBe('Yapay zekâ görünürlük karneniz: turadahil.com');
    expect(html).toContain('Merhaba Ayşe,');
    const ekte = 'turadahil.com için yapay zekâ görünürlük karneniz ekte: 4 sayfalık bir PDF.';
    expect(html).toContain(ekte);
    expect(html.indexOf('Merhaba Ayşe,')).toBeLessThan(html.indexOf(ekte));
    expect(html.match(/ekte/g)).toHaveLength(1);
    expect(html).toContain('4 sayfada: nereden başladığınız');
    expect(html).toContain(
      'Ansvisor’da Chat ve kullanıma hazır ajanlar ilk haftanın işlerini sizinle birlikte yapar.',
    );
    expect(html).toContain(
      'ChatGPT ve Microsoft Copilot (Ansvisor Starter’ın motorları) motorlarına Türkiye konumundan, alıcılarınızın sorduğu 25 soruyu sorduk.',
    );
    expect(html).toContain('50 yanıtın 0 tanesinde adınız geçiyor');
    expect(html).toContain('Ücretsiz denemeyi başlatın');
    expect(html).toContain('Kendi sorularınızı da ölçmek ister misiniz?');
    expect(html).toContain('Gizlilik Bildirimi');
    expect(html).not.toContain('Hi Ayşe');
    const failed = renderFailedEmail({ firstName: 'Ayşe', site: 'turadahil.com', country: 'TR' });
    expect(failed.subject).toBe('turadahil.com için karnenizi tamamlayamadık');
    expect(failed.html).not.toMatch(/ekte|PDF/);
  });

  it('states one visibility figure: every stat counts the headline’s answers', () => {
    // As the sample card: ChatGPT 7 of 25 and Copilot 2 of 25 head it; the
    // competitor and the citations are counted over those 50 answers.
    const { html } = renderReportCardEmail({
      firstName: 'Ayşe',
      payload: {
        ...payload,
        mainEngines: ['chatgpt-web', 'copilot-web'],
        engines: [
          { engine: 'chatgpt-web', answers: 25, named: 7 },
          { engine: 'copilot-web', answers: 25, named: 2 },
          { engine: 'gemini-web', answers: 25, named: 4 },
          { engine: 'google-aio', answers: 25, named: 5 },
          { engine: 'google-aimode', answers: 25, named: 2 },
        ],
        competitors: [{ name: 'Ridge & Co', answers: 41 }],
        ownCitations: 4,
      },
      kind: 'new',
      madeAt: '2026-11-04T10:00:00Z',
    });
    expect(html).toContain('18%');
    expect(html).toContain('named in 9 of 50 answers');
    expect(html).toContain('Answers that cite your site, of 50');
    // Never every engine's 125 answers, nor their 20 naming the company.
    expect(html).not.toMatch(/\b125\b|\b16%|named in 20\b/);
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

  it('says a card sent again is attached, when it was made, and when a new one can be', () => {
    const { html } = renderReportCardEmail({
      firstName: 'Mehmet',
      payload,
      kind: 'resent',
      madeAt: '2026-10-20T10:00:00Z',
      origin: 'https://app.ansvisor.com',
    });
    expect(html).toContain(
      'Your AI visibility report card for acme.example is attached: a 4-page PDF.',
    );
    expect(html).toContain(
      'It is the card we made for acme.example on Oct 20, 2026, sent again; a new one can be made from Nov 19, 2026.',
    );
    expect(html.match(/attached/g)).toHaveLength(1);
    const tr = renderReportCardEmail({
      firstName: 'Mehmet',
      payload: { ...payload, country: { code: 'TR', name: 'Türkiye' } },
      kind: 'resent',
      madeAt: '2026-10-20T10:00:00Z',
    });
    expect(tr.html).toContain(
      'acme.example için yapay zekâ görünürlük karneniz ekte: 4 sayfalık bir PDF.',
    );
    expect(tr.html).toContain('Bu, acme.example için 20 Eki 2026 tarihinde hazırladığımız karne');
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
    // No PDF goes with it, so it never says one is attached.
    expect(html).not.toMatch(/attached|PDF/);
  });

  it('writes in the language the request chose over the country’s', () => {
    const fr = renderReportCardEmail({
      firstName: 'Ayşe',
      payload,
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
      language: 'fr',
    });
    expect(fr.subject).toBe('Votre rapport de visibilité IA\u00a0: acme.example');
    expect(fr.html).toContain('Bonjour Ayşe,');
    expect(fr.html).toContain(
      'Votre rapport de visibilité IA pour acme.example est en pièce jointe\u00a0: un PDF de 4 pages.',
    );
    // The country in French, after "pays :" so no article must agree with it.
    expect(fr.html).toContain('(pays\u00a0: États-Unis)');
    expect(fr.html).toContain('19\u00a0%');
    expect(fr.html).toContain('Commencer l’essai gratuit');
    expect(fr.html).toContain('Politique de confidentialité');
    expect(fr.html).not.toMatch(/Hi Ayşe|Start a free trial/);
    // A Turkish card in English, and an American card in Turkish.
    const turkishCard = { ...payload, country: { code: 'TR', name: 'Türkiye' } };
    const en = renderReportCardEmail({
      firstName: 'Ayşe',
      payload: turkishCard,
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
      language: 'en',
    });
    expect(en.subject).toBe('Your AI visibility report card: acme.example');
    expect(en.html).toContain('questions your buyers ask, in Türkiye.');
    const tr = renderReportCardEmail({
      firstName: 'Ayşe',
      payload,
      kind: 'new',
      madeAt: '2026-11-03T10:00:00Z',
      language: 'tr',
    });
    expect(tr.html).toContain('Amerika Birleşik Devletleri konumundan');
    expect(tr.html).toContain('%19');
  });

  it('has a subject, a button and a resent line in every language', () => {
    const subjects = {};
    for (const language of ['en', 'tr', 'fr', 'es', 'de', 'pt', 'it', 'nl']) {
      const t = emailCopy('US', language);
      expect(t.locale.startsWith(language)).toBe(true);
      const { subject, html } = renderReportCardEmail({
        firstName: 'Ayşe',
        payload,
        kind: 'resent',
        madeAt: '2026-10-20T10:00:00Z',
        language,
      });
      subjects[language] = subject;
      expect(html).toContain(t.button);
      expect(html).toContain(t.attached('acme.example'));
      expect(html).not.toContain('undefined');
    }
    expect(new Set(Object.values(subjects)).size).toBe(8);
  });

  it('dates a card sent again in the chosen language’s way', () => {
    const resent = (language) =>
      renderReportCardEmail({
        firstName: 'Mehmet',
        payload,
        kind: 'resent',
        madeAt: '2026-10-20T10:00:00Z',
        language,
      }).html;
    expect(resent('de')).toContain(
      'Wir senden Ihnen erneut den Bericht, den wir am 20. Okt. 2026 für acme.example erstellt haben. Ein neuer kann ab dem 19. Nov. 2026 erstellt werden.',
    );
    expect(resent('es')).toContain('el 20 oct 2026');
    expect(resent('pt')).toContain('em 20 de out. de 2026');
    expect(resent('it')).toContain('il 20 ott 2026');
    expect(resent('nl')).toContain('op 20 okt 2026');
    expect(resent('fr')).toContain('le 20 oct. 2026');
  });

  it('writes the note for a card that couldn’t be made in the chosen language', () => {
    const de = renderFailedEmail({
      firstName: 'Ayşe',
      site: 'acme.example',
      country: 'TR',
      language: 'de',
    });
    expect(de.subject).toBe('Wir konnten Ihren Bericht für acme.example nicht fertigstellen');
    expect(de.html).toContain('Hallo Ayşe,');
    expect(de.html).not.toMatch(/PDF|Anhang/);
    const es = renderFailedEmail({ firstName: 'Ayşe', site: 'acme.example', language: 'es' });
    expect(es.subject).toBe('No pudimos terminar tu informe de acme.example');
    // None chosen: the country's rule, as before.
    expect(renderFailedEmail({ firstName: 'Ayşe', site: 'a.example', country: 'TR' }).subject).toBe(
      'a.example için karnenizi tamamlayamadık',
    );
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

  it('asks for the PDF in the language the request chose', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1),
    }));
    await renderCardPdf(payload, { language: 'nl', fetchImpl, env: { CRON_SECRET: 's3' } });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ card: payload, language: 'nl' });
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
    expect(first.html).toContain('is attached: a 4-page PDF.');
    expect(second.html).toContain('is attached: a 4-page PDF.');
    expect(second.html).toContain('sent again');
    expect(third.html).not.toContain('attached');
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
  it('sends each request in its own language, with a PDF drawn once a language', async () => {
    const s = store([
      { ...request('r1', ready), report_language: 'fr' },
      { ...request('r2', ready, 'resent'), report_language: 'fr' },
      { ...request('r3', ready), report_language: null },
      { ...request('r4', failed), country: 'US', report_language: 'it' },
    ]);
    const render = vi.fn(async (_payload, { language }) => Buffer.from(`%PDF-${language}`));
    const send = vi.fn(async () => 'sent');
    expect(await deliverReportCards({ store: s, render, send, now: () => NOW, env: {} })).toBe(4);
    expect(render.mock.calls.map(([, options]) => options)).toEqual([
      { language: 'fr' },
      { language: null },
    ]);
    const [fr, frAgain, auto, it] = send.mock.calls.map(([message]) => message);
    expect(fr.subject).toBe('Votre rapport de visibilité IA\u00a0: acme.example');
    expect(Buffer.from(fr.attachments[0].content, 'base64').toString()).toBe('%PDF-fr');
    expect(frAgain.html).toContain('Nous vous renvoyons le rapport établi pour acme.example');
    expect(auto.subject).toBe('Your AI visibility report card: acme.example');
    expect(Buffer.from(auto.attachments[0].content, 'base64').toString()).toBe('%PDF-null');
    expect(it.subject).toBe('Non siamo riusciti a completare il tuo report per other.example');
    expect(it).not.toHaveProperty('attachments');
  });
});
