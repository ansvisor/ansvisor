import supabaseAdmin from '../config/supabase.js';
import { getPlan, hasFeature } from '../config/plans.js';
import { brandReaders } from './access.js';
import { chatAgenticEnabled } from './chat-flag.js';
import { deliverEmailWithId } from './email.js';
import { logger } from './logger.js';
import { applyPlanOverrides } from './plan-guard.js';

/**
 * A scheduled job's e-mails (CHAT-12 items 19, 26; W3-04b), behind
 * CHAT_AGENTIC: its result once a run is done, and a note when a run didn't
 * run (after its retry) or the job turned itself off. Only for a job that
 * delivers by e-mail (deliver_to has 'email').
 *
 *   - To its creator and the people of its workspace it names
 *     (recipient_ids), never an address from outside (Wave 3 decision 2).
 *     Checked again as it is sent: each one still belongs to the
 *     workspace and still reaches the job's brand; one who doesn't is left
 *     out. Each gets their own e-mail.
 *   - What it says: the job's title, the answer's first 3–5 lines (no model
 *     call), "Open in Chat" and "Pause this job". Both open the app, where
 *     the person signs in.
 *   - The report as a PDF, attached up to 5 MB (the web renders it, as the
 *     answer's own PDF download): a bigger one, or none, is the Open in
 *     Chat link only.
 *   - From "Ansvisor", or the white label kit's company when the plan has
 *     white label and the kit names one, on RESEND_FROM_EMAIL's address.
 *   - A run's result goes once (chat_schedule_runs.email_status); its
 *     outcome and Resend's id are kept on the run.
 *   - Addresses outside the workspace (external_recipients, 00467; W4-28,
 *     Wave 4 decision 16) get nothing from a run: it only prepares their
 *     e-mail, a `pending` chat_outbound_emails row each, with the summary
 *     and the PDF kept in chat-files. Someone clicks Send on its Inbox card
 *     every time (chat-outbound-email.js); going live on its own never
 *     covers it.
 *
 * Through Resend (email.js): a silent no-op where it isn't configured.
 */

/** The largest report attached: a bigger one goes as the link (Wave 3 decision 3). */
export const PDF_ATTACH_MAX_BYTES = 5 * 1024 * 1024;
/** The summary's lines at most (CHAT-12 item 19: 3–5 lines). */
export const SUMMARY_LINES = 5;
const LINE_MAX = 240;

/** The dashboard's origin, for the e-mail's links. */
function appOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * An answer's first lines of text (CHAT-12 item 19's 3–5 line summary), its
 * Markdown taken out: headings' marks, list bullets, emphasis, links (their
 * words kept), code blocks and tables left out. No model call.
 * @param {string} markdown
 * @returns {string[]}
 */
export function summaryLines(markdown, max = SUMMARY_LINES) {
  const lines = [];
  let fenced = false;
  for (const raw of String(markdown ?? '').split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || line.startsWith('|') || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    const text = line
      .replace(/^>\s*/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^([-*+]|\d+[.)])\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|\*|_|`)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    lines.push(text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 1)}…` : text);
    if (lines.length >= max) break;
  }
  return lines;
}

/**
 * The name the e-mail comes from: the white label kit's company when the
 * workspace's plan has white label and the kit names one; else "Ansvisor".
 * A kit that can't be read is Ansvisor's, as the address is.
 * @param {string} orgId
 */
export async function senderNameOf(orgId) {
  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('plan, plan_overrides, subscription_status')
      .eq('id', orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!org || !hasFeature(applyPlanOverrides(getPlan(org.plan), org), 'white_label')) {
      return 'Ansvisor';
    }
    const { data: kit, error: kitError } = await supabaseAdmin
      .from('white_label_kits')
      .select('company_name')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (kitError) throw new Error(kitError.message);
    const company = typeof kit?.company_name === 'string' ? kit.company_name.trim() : '';
    return company || 'Ansvisor';
  } catch (err) {
    logger.warn({ err, orgId }, '[chat-schedule-email] could not read the white label kit');
    return 'Ansvisor';
  }
}

async function emailOf(id) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(id);
  return data?.user?.email ?? null;
}

/**
 * Who gets the job's e-mail now (above): its creator and recipient_ids,
 * those still of its workspace and, for a job about a brand, still reaching
 * it. Their addresses, one each.
 * @returns {Promise<{ id: string, email: string }[]>}
 */
export async function scheduleRecipients(job) {
  const ids = [...new Set([job.created_by, ...(job.recipient_ids ?? [])].filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', job.organization_id)
    .in('id', ids);
  if (error) throw new Error(error.message);
  let members = (data ?? []).map((row) => row.id);
  if (job.brand_id && members.length > 0) {
    const readers = await brandReaders(job.organization_id, [job.brand_id]);
    members = members.filter((id) => readers.get(id)?.has(job.brand_id));
  }
  const out = [];
  for (const id of members) {
    const email = await emailOf(id);
    if (email) out.push({ id, email });
  }
  return out;
}

const box = (inner) =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">${inner}</div>`;

const button = (href, label, primary = true) =>
  `<a href="${escapeHtml(href)}" style="${
    primary
      ? 'background:#111827;color:#ffffff;'
      : 'background:#ffffff;color:#111827;border:1px solid #d1d5db;'
  }text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;margin:0 8px 8px 0;">${escapeHtml(label)}</a>`;

const footer = (sender) =>
  `<p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">You get this because this scheduled job in ${escapeHtml(sender)} sends its results by e-mail. Pause the job, or change who gets it, on its page.</p>`;

/**
 * A run's result (CHAT-12 item 19).
 * @param {{ title: string, summary: string[], sender: string, chatUrl: string, jobUrl: string, attached: boolean }} input
 */
export function renderScheduleResultEmail({ title, summary, sender, chatUrl, jobUrl, attached }) {
  const lines = summary.length
    ? `<ul style="font-size:14px;color:#111827;margin:0 0 16px 0;padding-left:20px;">${summary
        .map((line) => `<li style="margin:0 0 6px 0;">${escapeHtml(line)}</li>`)
        .join('')}</ul>`
    : '';
  const file = attached
    ? 'The report is attached as a PDF.'
    : 'Open it in Chat to read it all and download it.';
  const html = box(`
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">${escapeHtml(title)}</h1>
  <p style="font-size:14px;color:#4b5563;margin:0 0 16px 0;">Your scheduled job ran. Here is what it found.</p>
  ${lines}
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${file}</p>
  <div style="margin:24px 0;">${button(chatUrl, 'Open in Chat')}${button(jobUrl, 'Pause this job', false)}</div>
  ${footer(sender)}`);
  return { subject: `${title}: your scheduled results`, html };
}

/**
 * A run that didn't run after its retry, or a job that turned itself off
 * (CHAT-12 items 16, 26–27): why, in plain words.
 * @param {{ kind: 'failed' | 'paused', title: string, reason: string, sender: string, chatUrl: string, jobUrl: string }} input
 */
export function renderScheduleProblemEmail({ kind, title, reason, sender, chatUrl, jobUrl }) {
  const head = kind === 'failed' ? `${title} didn't run` : `${title} is paused`;
  const next =
    kind === 'failed'
      ? 'It runs again at its next time. To try now, open the job and click Run now.'
      : 'It stays off until it is turned on again on its page.';
  const html = box(`
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">${escapeHtml(head)}</h1>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${escapeHtml(reason)}</p>
  <p style="font-size:14px;color:#4b5563;margin:0 0 16px 0;">${next}</p>
  <div style="margin:24px 0;">${button(jobUrl, kind === 'failed' ? 'Retry' : 'Open the job')}${button(chatUrl, 'Open in Chat', false)}</div>
  ${footer(sender)}`);
  return { subject: head, html };
}

/** Decoded size of a base64 text, in bytes. */
export function base64Bytes(text) {
  const clean = String(text ?? '').replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** A report the e-mail may carry: a PDF of 5 MB at most, else none (the link carries it). */
export function attachable(attachment) {
  if (!attachment?.content || !/\.pdf$/i.test(attachment.filename ?? '')) return null;
  const bytes = base64Bytes(attachment.content);
  if (bytes === 0 || bytes > PDF_ATTACH_MAX_BYTES) return null;
  return { filename: attachment.filename, content: attachment.content };
}

const JOB_COLUMNS =
  'id, organization_id, title, brand_id, created_by, recipient_ids, deliver_to, conversation_id, external_recipients';

/** Where a prepared e-mail's PDF waits for its Send (the private bucket of Chat's files). */
export const OUTBOUND_BUCKET = 'chat-files';
/** An outside address as 00467 keeps it: lowercase, one address. */
const OUTSIDE_ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * A summary line with no link into the app: an outside reader can't sign
 * in (Wave 4 decision 16). The answer's Markdown links are already words
 * (summaryLines); a bare address of the dashboard is taken out.
 */
export function withoutAppLinks(line) {
  let host = '';
  try {
    host = new URL(appOrigin()).host;
  } catch {
    host = '';
  }
  return String(line ?? '')
    .replace(/https?:\/\/[^\s<>()]+/gi, (url) => {
      try {
        return new URL(url).host === host ? '' : url;
      } catch {
        return url;
      }
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A run's e-mails to the job's addresses outside the workspace (above),
 * prepared, never sent: one `pending` row per address (expires_at, 7 days,
 * is the table's own), with the answer's first lines and the report's PDF,
 * kept once for the run in chat-files. A run prepared already keeps its
 * rows (the run and address are unique). How many it prepared now.
 * @param {{ job: { id: string, organization_id: string, title: string, external_recipients?: string[] }, run: { id: string }, lines: string[], attachment: { filename: string, content: string } | null }} input
 */
export async function prepareOutboundEmails({ job, run, lines, attachment }) {
  const addresses = [
    ...new Set((job.external_recipients ?? []).map((a) => String(a).trim().toLowerCase())),
  ]
    .filter((address) => address.length <= 254 && OUTSIDE_ADDRESS.test(address))
    .slice(0, 5);
  if (addresses.length === 0) return 0;
  const summary = lines.map(withoutAppLinks).filter(Boolean).join('\n').slice(0, 2000) || job.title;
  let files = [];
  if (attachment) {
    const path = `${job.organization_id}/outbound/${run.id}/report.pdf`;
    const bytes = Buffer.from(attachment.content, 'base64');
    try {
      const { error } = await supabaseAdmin.storage
        .from(OUTBOUND_BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (error) throw new Error(error.message);
      files = [{ path, name: attachment.filename.slice(0, 200), bytes: bytes.length }];
    } catch (err) {
      // No PDF kept: the e-mail still waits, with its summary.
      logger.warn({ err, runId: run.id }, 'could not keep the PDF of an outside e-mail');
    }
  }
  let made = 0;
  for (const to of addresses) {
    const { error } = await supabaseAdmin.from('chat_outbound_emails').insert({
      organization_id: job.organization_id,
      schedule_id: job.id,
      schedule_run_id: run.id,
      to_address: to,
      subject: String(job.title).slice(0, 200),
      summary,
      files,
    });
    if (!error) made += 1;
    else if (error.code !== '23505') {
      logger.error({ err: error, runId: run.id }, 'could not prepare an outside e-mail');
    }
  }
  return made;
}

/**
 * Sends a job's e-mail (above): `result` for a run that is done, `failed`
 * for a run that didn't run after its retry, `paused` for a job that turned
 * itself off. What went out: { status: 'sent' | 'failed' | 'skipped' |
 * 'not_found', sent }: skipped with Chat off, a job that doesn't e-mail, a
 * run already e-mailed, no one to send to, or Resend not configured. A
 * result for a job with outside addresses also prepares their e-mails,
 * sending none of them, with how many it prepared (`prepared`).
 * @param {{ orgId: string, scheduleId: string, runId?: string | null, kind: 'result' | 'failed' | 'paused', reason?: string, attachment?: { filename: string, content: string } | null }} input
 */
export async function sendScheduleEmail({
  orgId,
  scheduleId,
  runId = null,
  kind,
  reason = '',
  attachment = null,
}) {
  if (!chatAgenticEnabled(orgId)) return { status: 'skipped', sent: 0 };
  const { data: job, error } = await supabaseAdmin
    .from('chat_schedules')
    .select(JOB_COLUMNS)
    .eq('id', scheduleId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) return { status: 'not_found', sent: 0 };
  const byEmail = (job.deliver_to ?? []).includes('email');
  // A result for outside addresses is only prepared, whatever deliver_to says (W4-28).
  const outside = kind === 'result' && (job.external_recipients ?? []).length > 0;
  if (!byEmail && !outside) return { status: 'skipped', sent: 0 };

  let run = null;
  if (runId) {
    const { data, error: runError } = await supabaseAdmin
      .from('chat_schedule_runs')
      .select('id, schedule_id, message_id, email_status')
      .eq('id', runId)
      .eq('schedule_id', scheduleId)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    if (!data) return { status: 'not_found', sent: 0 };
    run = data;
  }
  if (kind === 'result' && !run) return { status: 'not_found', sent: 0 };

  let markdown = '';
  if (kind === 'result' && run.message_id) {
    const { data: answer, error: answerError } = await supabaseAdmin
      .from('chat_messages')
      .select('content_md')
      .eq('id', run.message_id)
      .maybeSingle();
    if (answerError) throw new Error(answerError.message);
    markdown = answer?.content_md ?? '';
  }
  const file = kind === 'result' ? attachable(attachment) : null;

  let extra = {};
  if (outside) {
    let prepared = 0;
    try {
      prepared = await prepareOutboundEmails({
        job,
        run,
        lines: summaryLines(markdown),
        attachment: file,
      });
    } catch (err) {
      logger.error({ err, orgId, scheduleId }, 'could not prepare the outside e-mails');
    }
    extra = { prepared };
  }
  // A run's e-mail goes once.
  if (!byEmail || run?.email_status) return { status: 'skipped', sent: 0, ...extra };

  const recipients = await scheduleRecipients(job);
  if (recipients.length === 0) return { status: 'skipped', sent: 0, ...extra };

  const origin = appOrigin();
  const jobUrl = `${origin}/dashboard/chat/scheduled/${job.id}`;
  const chatUrl = job.conversation_id ? `${origin}/dashboard/chat/${job.conversation_id}` : jobUrl;
  const sender = await senderNameOf(orgId);

  let message;
  let files = [];
  if (kind === 'result') {
    files = file ? [file] : [];
    message = renderScheduleResultEmail({
      title: job.title,
      summary: summaryLines(markdown),
      sender,
      chatUrl,
      jobUrl,
      attached: files.length > 0,
    });
  } else {
    message = renderScheduleProblemEmail({
      kind,
      title: job.title,
      reason: String(reason).slice(0, 200),
      sender,
      chatUrl,
      jobUrl,
    });
  }

  let sent = 0;
  let tried = 0;
  let firstId = null;
  for (const recipient of recipients) {
    const outcome = await deliverEmailWithId({
      to: [recipient.email],
      ...message,
      fromName: sender,
      ...(files.length ? { attachments: files } : {}),
    });
    if (outcome.status !== 'skipped') tried += 1;
    if (outcome.status === 'sent') {
      sent += 1;
      firstId ??= outcome.id;
    } else if (outcome.status !== 'skipped') {
      logger.warn({ orgId, scheduleId, outcome: outcome.status }, 'scheduled job e-mail not sent');
    }
  }
  // Resend not configured (self-hosted): nothing went out, nothing to keep.
  if (tried === 0) return { status: 'skipped', sent: 0, ...extra };
  const status = sent > 0 ? 'sent' : 'failed';
  if (run) {
    const { error: keepError } = await supabaseAdmin
      .from('chat_schedule_runs')
      .update({ email_status: status, ...(firstId ? { resend_message_id: firstId } : {}) })
      .eq('id', run.id);
    if (keepError) logger.error({ err: keepError, runId }, 'could not keep a run’s e-mail');
  }
  return { status, sent, ...extra };
}
