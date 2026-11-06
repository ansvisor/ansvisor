import { webAppOrigin } from '../chat-agents.js';
import { deliverEmail } from '../email.js';
import logger from '../logger.js';
import { countryInSentence } from './countries.js';
import { reportCardStore } from './store.js';

/**
 * The report card's e-mail (REPORT-CARD §1, §4, §7): the PDF attached, the
 * headline figures, and a "Start a free trial" invitation; from Ansvisor
 * (REPORT_CARD_FROM_EMAIL, else RESEND_FROM_EMAIL). Each minute the queue
 * sends what is waiting: a new card once it's ready, a card sent again
 * (resent), and a short note when a card couldn't be made. The PDF is drawn
 * by the web app (POST /api/internal/report-card/pdf) from the card's
 * figures, once a card a sweep.
 */

export const PRIVACY_URL = 'https://www.ansvisor.com/privacy-policy';
/** Requests one sweep sends at most. */
const SWEEP_LIMIT = 20;
/** How often a PDF the web couldn't draw is tried, a sweep apart, before the e-mail is given up. */
export const MAX_PDF_ATTEMPTS = 30;
/** The web's answer for figures it will never draw: the only failure given up at once. */
const UNPROCESSABLE = 422;
const DAY_MS = 24 * 60 * 60 * 1000;

const ENGINE_NAMES = {
  'chatgpt-web': 'ChatGPT',
  'copilot-web': 'Microsoft Copilot',
  'gemini-web': 'Gemini',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The trial's sign-up page, marked as coming from the card's e-mail. */
export function signUpUrl(origin = webAppOrigin()) {
  return `${origin}/en/sign-up?utm_source=report-card&utm_medium=email`;
}

/** "ansvisor-ai-visibility-report-card-acme.com.pdf" */
export const pdfName = (site) =>
  `ansvisor-ai-visibility-report-card-${String(site).replace(/[^a-z0-9.-]/gi, '-')}.pdf`;

/** Ansvisor's colors (the brand style guide): ink, a warm grey and a sand border. */
const INK = '#1C1A17';
const GREY = '#464442';
const SAND = '#EBE6DE';

/** "A", "A and B", "A, B and C"; "A ve B" in Turkish. */
const listIn = (items, and) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`;

/**
 * The e-mail's words, in the card's language (owner decision 2026-11-04):
 * Turkish for Türkiye, English elsewhere, as the PDF (web
 * lib/report-card/copy.ts). Names and sites never take a Turkish case
 * ending: "{site} için".
 */
const EMAIL_COPY = {
  en: {
    locale: 'en-US',
    and: 'and',
    footer: `You asked for this report card on ansvisor.com. AI answers change from day to day, so it is a snapshot. How we use your details: <a href="${PRIVACY_URL}" style="color:${GREY};">Privacy Notice</a>.`,
    title: 'Your AI visibility report card',
    hi: (name) => `Hi ${name},`,
    resent: (site, made, next) =>
      `Here is ${site}’s report card again: we made it on ${made}, and a new one can be made from ${next}.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `We asked ${engines}${starter ? ', the engines in Ansvisor Starter,' : ''} ${questions} questions your ${readers ? 'readers' : 'buyers'} ask, in ${country}. Here is what came back for ${site}.`,
    growth: (engines) =>
      ` We asked ${engines} too: they are in Ansvisor Growth, and the PDF shows them apart.`,
    visibility: (engines, named, answers) =>
      `AI visibility${engines ? ` in ${engines}` : ''}: named in ${named} of ${answers} answers`,
    leader: (answers) => `Top competitor: named in ${answers} answers`,
    noLeader: 'None',
    noLeaderLabel: 'No competitor was named',
    cited: (answers) => `Answers that cite your site, of ${answers}`,
    pages: (questions) =>
      `Your report card is attached as a PDF, 4 pages: where you start and who AI names instead, all ${questions} questions we asked and what each engine said, what you’d do in your first week, and what AI visits are worth with the plan that matches.`,
    button: 'Start a free trial',
    own: 'Want to measure your own questions too? In the free trial, Ansvisor asks this card’s questions and yours every day, and ranks what to do next.',
    subject: (domain) => `Your AI visibility report card: ${domain}`,
    failedTitle: 'We couldn’t finish your report card',
    failed: (site) =>
      `We couldn’t finish the AI visibility report card for ${site}. Reply to this e-mail and we’ll look into it.`,
    failedSubject: (site) => `We couldn’t finish your report card for ${site}`,
  },
  tr: {
    locale: 'tr-TR',
    and: 've',
    footer: `Bu karneyi ansvisor.com üzerinden istediniz. Yapay zekâ yanıtları her gün değişir; bu bir anlık ölçümdür. Bilgilerinizi nasıl kullandığımız: <a href="${PRIVACY_URL}" style="color:${GREY};">Gizlilik Bildirimi</a>.`,
    title: 'Yapay zekâ görünürlük karneniz',
    hi: (name) => `Merhaba ${name},`,
    resent: (site, made, next) =>
      `${site} için karneniz yeniden ekte: ${made} tarihinde hazırladık; yenisi ${next} tarihinden itibaren hazırlanabilir.`,
    intro: (engines, starter, questions, readers, country, site) =>
      `${engines}${starter ? ' (Ansvisor Starter’ın motorları)' : ''} motorlarına ${country} konumundan, ${readers ? 'okurlarınızın' : 'alıcılarınızın'} sorduğu ${questions} soruyu sorduk. ${site} için sonuçlar aşağıda.`,
    growth: (engines) =>
      ` ${engines} motorlarına da sorduk: bunlar Ansvisor Growth’ta; PDF bunları ayrı gösteriyor.`,
    visibility: (engines, named, answers) =>
      `Yapay zekâ görünürlüğü${engines ? ` (${engines})` : ''}: ${answers} yanıtın ${named} tanesinde adınız geçiyor`,
    leader: (answers) => `Öne çıkan rakip: ${answers} yanıtta anılıyor`,
    noLeader: 'Yok',
    noLeaderLabel: 'Hiçbir rakip anılmadı',
    cited: (answers) => `${answers} yanıttan sitenizi kaynak gösteren`,
    pages: (questions) =>
      `Karneniz ekte, 4 sayfalık bir PDF: nereden başladığınız ve yapay zekânın sizin yerinize kimi önerdiği, sorduğumuz ${questions} sorunun tamamı ve her motorun yanıtı, ilk haftanızda yapacaklarınız ve yapay zekâ ziyaretlerinin değeriyle size uyan plan.`,
    button: 'Ücretsiz denemeyi başlatın',
    own: 'Kendi sorularınızı da ölçmek ister misiniz? Ücretsiz denemede Ansvisor bu karnenin sorularını ve sizinkileri her gün sorar, sıradaki işleri öncelik sırasıyla verir.',
    subject: (domain) => `Yapay zekâ görünürlük karneniz: ${domain}`,
    failedTitle: 'Karnenizi tamamlayamadık',
    failed: (site) =>
      `${site} için yapay zekâ görünürlük karnesini tamamlayamadık. Bu e-postayı yanıtlayın, inceleyelim.`,
    failedSubject: (site) => `${site} için karnenizi tamamlayamadık`,
  },
};

/** The e-mail's words for a card's country: Turkish for Türkiye, else English. */
export const emailCopy = (countryCode) =>
  String(countryCode ?? '').toUpperCase() === 'TR' ? EMAIL_COPY.tr : EMAIL_COPY.en;

const formatDateIn = (iso, locale) =>
  new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

const shell = (
  inner,
  t,
) => `<div style="font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:${INK};">
${inner}
  <p style="font-size:12px;color:${GREY};border-top:1px solid ${SAND};padding-top:16px;margin-top:24px;">
    ${t.footer}
  </p>
</div>`;

const stat = (value, label) =>
  `<td style="padding:12px;border:1px solid ${SAND};border-radius:8px;vertical-align:top;width:33%;background:#ffffff;">
      <div style="font-size:20px;font-weight:600;letter-spacing:-0.02em;color:${INK};">${value}</div>
      <div style="font-size:12px;color:${GREY};margin-top:4px;">${label}</div>
    </td>`;

/**
 * The e-mail for a ready card: new, or sent again, in the card's language.
 *
 * @param {{ firstName: string, payload: object, kind: 'new'|'resent', madeAt: string, repeatDays?: number, origin?: string }} input
 * @returns {{ subject: string, html: string }}
 */
export function renderReportCardEmail({
  firstName,
  payload,
  kind,
  madeAt,
  repeatDays = 30,
  origin,
}) {
  const t = emailCopy(payload.country?.code);
  // The headline is Starter's engines (ChatGPT and Gemini); a
  // card made before they were split counts every engine. The competitors
  // and own citations are counted over the same answers (analyze.js
  // summarize), so the three figures share one base.
  const banded = Array.isArray(payload.mainEngines) && payload.mainEngines.length > 0;
  const main = banded
    ? payload.engines.filter((e) => payload.mainEngines.includes(e.engine))
    : payload.engines;
  const growth = banded
    ? payload.engines.filter((e) => !payload.mainEngines.includes(e.engine))
    : [];
  const answers = main.reduce((sum, e) => sum + e.answers, 0);
  const named = main.reduce((sum, e) => sum + e.named, 0);
  const visibility = answers ? Math.round((named / answers) * 100) : 0;
  const leader = payload.competitors[0];
  const site = escapeHtml(payload.domain);
  const nameOf = (e) => ENGINE_NAMES[e.engine] ?? e.engine;
  const engines = escapeHtml(listIn(main.map(nameOf), t.and));
  const growthLine = growth.length ? t.growth(escapeHtml(listIn(growth.map(nameOf), t.and))) : '';
  const country =
    t === EMAIL_COPY.tr
      ? escapeHtml(payload.country.name)
      : escapeHtml(countryInSentence(payload.country.code, payload.country.name));

  const intro =
    kind === 'resent'
      ? t.resent(
          site,
          escapeHtml(formatDateIn(madeAt, t.locale)),
          escapeHtml(
            formatDateIn(
              new Date(new Date(madeAt).getTime() + repeatDays * DAY_MS).toISOString(),
              t.locale,
            ),
          ),
        )
      : `${t.intro(engines, banded, payload.questionCount, payload.audience === 'readers', country, site)}${growthLine}`;

  const html = shell(
    `  <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.03em;margin:0 0 16px 0;">${t.title}</h1>
  <p style="font-size:14px;margin:0 0 12px 0;">${t.hi(escapeHtml(firstName))}</p>
  <p style="font-size:14px;margin:0 0 16px 0;">${intro}</p>
  <table role="presentation" cellspacing="8" style="width:100%;border-collapse:separate;margin:0 -8px 8px -8px;">
    <tr>
    ${stat(`${visibility}%`, t.visibility(banded ? engines : null, named, answers))}
    ${stat(leader ? escapeHtml(leader.name) : t.noLeader, leader ? t.leader(leader.answers) : t.noLeaderLabel)}
    ${stat(String(payload.ownCitations), t.cited(answers))}
    </tr>
  </table>
  <p style="font-size:14px;margin:8px 0 16px 0;">${t.pages(payload.questionRows?.length || payload.questionCount)}</p>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(signUpUrl(origin))}" style="background:${INK};color:#ffffff;text-decoration:none;padding:8px 28px;border-radius:100px;font-size:15px;font-weight:500;display:inline-block;">${t.button}</a>
  </div>
  <p style="font-size:14px;color:${GREY};margin:0;">${t.own}</p>`,
    t,
  );

  return { subject: t.subject(payload.domain), html };
}

/** The note for a card that couldn't be made, in its country's language. */
export function renderFailedEmail({ firstName, site, country }) {
  const t = emailCopy(country);
  const html = shell(
    `  <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.03em;margin:0 0 16px 0;">${t.failedTitle}</h1>
  <p style="font-size:14px;margin:0 0 12px 0;">${t.hi(escapeHtml(firstName))}</p>
  <p style="font-size:14px;margin:0 0 16px 0;">${t.failed(escapeHtml(site))}</p>`,
    t,
  );
  return { subject: t.failedSubject(site), html };
}

/**
 * The card's PDF from the web app, as bytes. Throws with `status` when the
 * web refused the figures (4xx), and without when it couldn't be reached.
 */
export async function renderCardPdf(payload, { fetchImpl = fetch, env = process.env } = {}) {
  const secret = env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set: the PDF cannot be asked for');
  const res = await fetchImpl(`${webAppOrigin()}/api/internal/report-card/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ card: payload }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`The PDF was refused (${res.status})`), { status: res.status });
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Sends the e-mails waiting: one a request, each marked with what became of
 * it, so none goes twice. A PDF the web couldn't draw waits for the next
 * sweep, behind the e-mails not yet tried, and is given up (refused) after
 * MAX_PDF_ATTEMPTS; one whose figures it refuses (422) is given up at once.
 */
export async function deliverReportCards({
  store = reportCardStore(),
  render = renderCardPdf,
  send = deliverEmail,
  now = () => new Date(),
  env = process.env,
} = {}) {
  const waiting = await store.undeliveredRequests(SWEEP_LIMIT);
  const pdfs = new Map();
  const from = env.REPORT_CARD_FROM_EMAIL || undefined;
  const replyTo = env.REPORT_CARD_REPLY_TO || undefined;
  let sent = 0;
  for (const request of waiting) {
    const card = request.report_cards;
    let message;
    if (card.status === 'failed') {
      message = renderFailedEmail({
        firstName: request.first_name,
        site: card.site,
        country: request.country,
      });
    } else {
      if (!pdfs.has(card.id)) {
        try {
          pdfs.set(card.id, await render(card.payload));
        } catch (err) {
          // Only figures the web refuses (422) are given up at once. A 401 (a
          // CRON_SECRET out of step), a 404 (the web not yet deployed) or a
          // 5xx is tried again on the next sweep, up to MAX_PDF_ATTEMPTS.
          const attempts = (request.email_attempts ?? 0) + 1;
          const giveUp = err.status === UNPROCESSABLE || attempts >= MAX_PDF_ATTEMPTS;
          logger.error(
            { err: err.message, status: err.status, cardId: card.id, attempts, giveUp },
            '[report-card] PDF not drawn',
          );
          if (giveUp) await store.markEmailed(request.id, 'refused', now());
          else await store.markEmailAttempt(request.id, attempts);
          continue;
        }
      }
      message = {
        ...renderReportCardEmail({
          firstName: request.first_name,
          payload: card.payload,
          kind: request.outcome === 'resent' ? 'resent' : 'new',
          madeAt: card.created_at,
        }),
        attachments: [
          { filename: pdfName(card.site), content: pdfs.get(card.id).toString('base64') },
        ],
      };
    }
    const status = await send({ to: [request.email], from, replyTo, ...message });
    await store.markEmailed(request.id, status, now());
    if (status === 'sent') sent += 1;
  }
  return sent;
}
