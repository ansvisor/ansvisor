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

/** "A", "A and B", "A, B and C". */
const listOf = (items) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

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

const shell = (
  inner,
) => `<div style="font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:${INK};">
${inner}
  <p style="font-size:12px;color:${GREY};border-top:1px solid ${SAND};padding-top:16px;margin-top:24px;">
    You asked for this report card on ansvisor.com. AI answers change from day to day, so it is a snapshot. How we use your details: <a href="${PRIVACY_URL}" style="color:${GREY};">Privacy Notice</a>.
  </p>
</div>`;

const stat = (value, label) =>
  `<td style="padding:12px;border:1px solid ${SAND};border-radius:8px;vertical-align:top;width:33%;background:#ffffff;">
      <div style="font-size:20px;font-weight:600;letter-spacing:-0.02em;color:${INK};">${value}</div>
      <div style="font-size:12px;color:${GREY};margin-top:4px;">${label}</div>
    </td>`;

/**
 * The e-mail for a ready card: new, or sent again.
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
  const answers = payload.engines.reduce((sum, e) => sum + e.answers, 0);
  const named = payload.engines.reduce((sum, e) => sum + e.named, 0);
  const visibility = answers ? Math.round((named / answers) * 100) : 0;
  const leader = payload.competitors[0];
  const site = escapeHtml(payload.domain);
  const engines = listOf(payload.engines.map((e) => ENGINE_NAMES[e.engine] ?? e.engine));

  const intro =
    kind === 'resent'
      ? `<p style="font-size:14px;margin:0 0 16px 0;">Here is ${site}’s report card again: we made it on ${escapeHtml(formatDate(madeAt))}, and a new one can be made from ${escapeHtml(formatDate(new Date(new Date(madeAt).getTime() + repeatDays * DAY_MS).toISOString()))}.</p>`
      : `<p style="font-size:14px;margin:0 0 16px 0;">We asked ${escapeHtml(engines)} ${payload.questionCount} questions your ${payload.audience === 'readers' ? 'readers' : 'buyers'} ask, in ${escapeHtml(countryInSentence(payload.country.code, payload.country.name))}. Here is what came back for ${site}.</p>`;

  const html =
    shell(`  <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.03em;margin:0 0 16px 0;">Your AI visibility report card</h1>
  <p style="font-size:14px;margin:0 0 12px 0;">Hi ${escapeHtml(firstName)},</p>
  ${intro}
  <table role="presentation" cellspacing="8" style="width:100%;border-collapse:separate;margin:0 -8px 8px -8px;">
    <tr>
    ${stat(`${visibility}%`, `AI visibility: named in ${named} of ${answers} answers`)}
    ${stat(leader ? escapeHtml(leader.name) : 'None', leader ? `Top competitor: named in ${leader.answers} answers` : 'No competitor was named')}
    ${stat(String(payload.ownCitations), `Answers that cite your site, of ${answers}`)}
    </tr>
  </table>
  <p style="font-size:14px;margin:8px 0 16px 0;">Your report card is attached as a PDF, 4 pages: your results and three things to do now, what’s in Ansvisor and how you can use it, what AI visits could be worth to you, and all ${payload.questionRows?.length || payload.questionCount} questions we asked.</p>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(signUpUrl(origin))}" style="background:${INK};color:#ffffff;text-decoration:none;padding:8px 28px;border-radius:100px;font-size:15px;font-weight:500;display:inline-block;">Start a free trial</a>
  </div>
  <p style="font-size:14px;color:${GREY};margin:0;">Want this every day, for every question you care about? Ansvisor tracks your brand in AI answers and ranks what to do next.</p>`);

  return { subject: `Your AI visibility report card: ${payload.domain}`, html };
}

/** The note for a card that couldn't be made. */
export function renderFailedEmail({ firstName, site }) {
  const html =
    shell(`  <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.03em;margin:0 0 16px 0;">We couldn’t finish your report card</h1>
  <p style="font-size:14px;margin:0 0 12px 0;">Hi ${escapeHtml(firstName)},</p>
  <p style="font-size:14px;margin:0 0 16px 0;">We couldn’t finish the AI visibility report card for ${escapeHtml(site)}. Reply to this e-mail and we’ll look into it.</p>`);
  return { subject: `We couldn’t finish your report card for ${site}`, html };
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
      message = renderFailedEmail({ firstName: request.first_name, site: card.site });
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
