import supabaseAdmin from '../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../config/plans.js';
import { MANAGER_ROLES, brandReaders } from './access.js';
import { chatAgenticEnabled } from './chat-flag.js';
import { OUTBOUND_BUCKET, escapeHtml, senderNameOf } from './chat-schedule-email.js';
import { deliverEmailWithId } from './email.js';
import { logger } from './logger.js';

/**
 * A scheduled job's e-mails to addresses outside the workspace (W4-28,
 * Chat Wave 4 decision 16; chat_outbound_emails, 00467), behind
 * CHAT_AGENTIC. A run only prepares them (chat-schedule-email.js); each
 * goes out when a person clicks Send on its Inbox card, every time: an
 * EXECUTE that Full auto and the agents' going live on their own never
 * cover. Nothing here runs without that click.
 *
 *   - Who: an Admin or a Manager (the route checks the role, and so does
 *     this), who sees the job (its creator, or an Admin) and reaches its
 *     brand. Not in the free trial: Starter and up, paid and active.
 *   - Which: a pending e-mail, its address still on the job, prepared in
 *     the last 7 days. One past its expires_at is `expired` here and in
 *     the minute sweep (expireOutboundEmails).
 *   - How many: 50 sent a day per workspace, the last 24 hours, counted
 *     from the sent rows with this one claimed first, so two clicks at once
 *     never pass the limit.
 *   - What goes: the job's title, the answer's first lines and the
 *     report's PDF; no link into the app, nothing that asks to sign in, and
 *     the footer "Sent by {person} from {workspace} via Ansvisor".
 *     Reply-To is the person who clicked Send. Through email.js (Resend).
 *   - Kept: sent (when, who, Resend's id), or pending again with why when
 *     Resend didn't take it; Cancel makes it cancelled. Each Send and
 *     Cancel is a row in Chat's activity log (00402). The PDF is let go once
 *     no e-mail of its run waits.
 */

/** Sends outside the workspace a day, per workspace (decision 16). */
export const OUTSIDE_DAILY_MAX = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const ROW_COLUMNS =
  'id, organization_id, schedule_id, schedule_run_id, to_address, subject, summary, files, status, expires_at';
const JOB_COLUMNS =
  'id, organization_id, title, brand_id, created_by, conversation_id, external_recipients';

/** A refusal: what the route answers. */
const refused = (code, status, message = null) => ({ ok: false, code, status, message });

/** Why a send failed, in plain words, kept on the row for the card (00467: never a raw error). */
const FAILED_WORDS = {
  refused: 'The e-mail service didn’t take it. Try again in a few minutes.',
  unknown: 'We couldn’t confirm it went out. Check with the recipient before you send it again.',
  skipped: 'E-mail isn’t set up on this server.',
  file: 'The report’s PDF couldn’t be read. Try again.',
};

/**
 * Why the workspace's plan can't e-mail outside the workspace now: `trial`
 * in the free trial (decision 16: Starter and up), `plan` without an active
 * plan; null when it can. Self-hosted, billing doesn't apply.
 * @param {{ plan?: string | null, subscription_status?: string | null } | null} org
 */
export function outsidePlanRefusal(org) {
  if (!isCloud()) return null;
  if (!org || !isSubscriptionActive(org.subscription_status)) return 'plan';
  // As the web's plan facts read a trial: Enterprise's trials are a deal's.
  if (org.subscription_status === 'trialing' && org.plan !== 'enterprise') return 'trial';
  return null;
}

/**
 * The e-mail an outside reader gets: the job's title, the answer's first
 * lines, a line about the PDF when one is attached, and the footer. No
 * link, no button: nothing asks them to sign in.
 * @param {{ title: string, summary: string[], person: string, workspace: string, attached: boolean }} input
 */
export function renderOutsideEmail({ title, summary, person, workspace, attached }) {
  const lines = summary.length
    ? `<ul style="font-size:14px;color:#111827;margin:0 0 16px 0;padding-left:20px;">${summary
        .map((line) => `<li style="margin:0 0 6px 0;">${escapeHtml(line)}</li>`)
        .join('')}</ul>`
    : '';
  const file = attached
    ? '<p style="font-size:14px;color:#111827;margin:0 0 16px 0;">The full report is attached as a PDF.</p>'
    : '';
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 16px 0;">${escapeHtml(title)}</h1>
  ${lines}
  ${file}
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">Sent by ${escapeHtml(person)} from ${escapeHtml(workspace)} via Ansvisor</p>
</div>`;
  return { subject: title, html };
}

async function readCaller(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, organization_id, role, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The e-mail and its job, when the caller may act on it: Chat on, an Admin
 * or a Manager of its workspace, the job theirs or the caller an Admin, its
 * brand within their access. Else a refusal (another workspace's reads as
 * not found).
 */
async function readForCaller(userId, id) {
  const caller = await readCaller(userId);
  const orgId = caller?.organization_id;
  if (!orgId || !chatAgenticEnabled(orgId)) return { refusal: refused('not_found', 404) };
  const { data: row, error } = await supabaseAdmin
    .from('chat_outbound_emails')
    .select(ROW_COLUMNS)
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { refusal: refused('not_found', 404) };
  const { data: job, error: jobError } = await supabaseAdmin
    .from('chat_schedules')
    .select(JOB_COLUMNS)
    .eq('id', row.schedule_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return { refusal: refused('not_found', 404) };
  if (!MANAGER_ROLES.includes(caller.role)) return { refusal: refused('forbidden', 403) };
  if (caller.role !== 'admin' && job.created_by !== caller.id) {
    return { refusal: refused('not_found', 404) };
  }
  if (job.brand_id) {
    const readers = await brandReaders(orgId, [job.brand_id]);
    if (!readers.get(caller.id)?.has(job.brand_id)) return { refusal: refused('not_found', 404) };
  }
  return { caller, row, job };
}

/** An e-mail that can't be acted on any more: past its time (now expired), or no longer pending. */
async function settledRefusal(row, now) {
  if (row.status !== 'pending') return refused(row.status, 409);
  if (Date.parse(row.expires_at) > now.getTime()) return null;
  await expireOne(row.id);
  return refused('expired', 410);
}

async function expireOne(id) {
  const { error } = await supabaseAdmin
    .from('chat_outbound_emails')
    .update({ status: 'expired', send_error: null })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  await letFilesGo([id]);
}

/** Back to pending, after a claim that couldn't go on: with why, when Resend didn't take it. */
async function release(id, words) {
  const { error } = await supabaseAdmin
    .from('chat_outbound_emails')
    .update({ status: 'pending', sent_at: null, approved_by: null, send_error: words })
    .eq('id', id)
    .eq('status', 'sent');
  if (error) logger.error({ err: error, id }, 'could not put an outside e-mail back to pending');
}

/**
 * The PDFs of these e-mails' runs, once no e-mail of the run waits for a
 * Send. Never throws: a file left behind costs a little storage.
 * @param {string[]} ids
 */
async function letFilesGo(ids) {
  try {
    if (ids.length === 0) return;
    const { data: rows, error } = await supabaseAdmin
      .from('chat_outbound_emails')
      .select('schedule_run_id, files')
      .in('id', ids);
    if (error) throw new Error(error.message);
    const byRun = new Map();
    for (const row of rows ?? []) {
      if (!row.schedule_run_id) continue;
      const paths = (row.files ?? []).map((f) => f?.path).filter(Boolean);
      if (paths.length) byRun.set(row.schedule_run_id, paths);
    }
    for (const [runId, paths] of byRun) {
      const { data: waiting, error: waitError } = await supabaseAdmin
        .from('chat_outbound_emails')
        .select('id')
        .eq('schedule_run_id', runId)
        .eq('status', 'pending')
        .limit(1);
      if (waitError) throw new Error(waitError.message);
      if ((waiting ?? []).length > 0) continue;
      const { error: removeError } = await supabaseAdmin.storage
        .from(OUTBOUND_BUCKET)
        .remove([...new Set(paths)]);
      if (removeError) throw new Error(removeError.message);
    }
  } catch (err) {
    logger.warn({ err }, 'could not let an outside e-mail’s PDF go');
  }
}

/** The PDFs to attach, read from chat-files; null when one can't be read. */
async function attachmentsOf(files) {
  const out = [];
  for (const file of files ?? []) {
    if (!file?.path) continue;
    const { data, error } = await supabaseAdmin.storage.from(OUTBOUND_BUCKET).download(file.path);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    out.push({ filename: file.name || 'report.pdf', content: bytes.toString('base64') });
  }
  return out;
}

/** Each Send and Cancel in Chat's activity log (00402): never undoes what was done. */
async function logActivity({ caller, job, row, sent }) {
  const { error } = await supabaseAdmin.from('chat_activity_log').insert({
    organization_id: job.organization_id,
    user_id: caller.id,
    brand_id: job.brand_id ?? null,
    conversation_id: job.conversation_id ?? null,
    surface: 'schedule',
    kind: 'change',
    tool_key: sent ? 'sendOutsideEmail' : 'cancelOutsideEmail',
    // Send is an EXECUTE, clicked; Cancel the person's own change, with no card.
    class: sent ? 'execute' : 'write',
    approval_kind: sent ? 'click' : 'run',
    target_type: 'chat_outbound_email',
    target_id: row.id,
    summary_key: sent ? 'outsideEmailSent' : 'outsideEmailCancelled',
    summary_params: { title: String(job.title).slice(0, 120), to: row.to_address },
  });
  if (error) logger.error({ err: error, id: row.id }, 'could not log an outside e-mail');
}

async function emailOf(id) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(id);
  return data?.user?.email ?? null;
}

/**
 * Send, clicked by `userId` (above). { ok: true } once Resend took it; else
 * a refusal { ok: false, code, status, message }: not_found 404, forbidden
 * 403, trial or plan 402, expired 410, sent/cancelled/removed/busy 409,
 * daily_limit 429, send_failed 502 (pending again, with why).
 * @param {{ userId: string, id: string, now?: Date }} input
 */
export async function sendOutsideEmail({ userId, id, now = new Date() }) {
  const found = await readForCaller(userId, id);
  if (found.refusal) return found.refusal;
  const { caller, row, job } = found;
  const settled = await settledRefusal(row, now);
  if (settled) return settled;
  // An address taken off the job since its run doesn't get it.
  if (!(job.external_recipients ?? []).includes(row.to_address)) return refused('removed', 409);
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('name, plan, subscription_status')
    .eq('id', job.organization_id)
    .maybeSingle();
  if (orgError) throw new Error(orgError.message);
  const planRefusal = outsidePlanRefusal(org);
  if (planRefusal) return refused(planRefusal, 402);

  // Claimed first: a second click, or a second person, finds it taken.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('chat_outbound_emails')
    .update({
      status: 'sent',
      sent_at: now.toISOString(),
      approved_by: caller.id,
      send_error: null,
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .gt('expires_at', now.toISOString())
    .select('id')
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return refused('busy', 409);

  // The workspace's sends in the last 24 hours, this one with them.
  const { count, error: countError } = await supabaseAdmin
    .from('chat_outbound_emails')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', job.organization_id)
    .eq('status', 'sent')
    .gt('sent_at', new Date(now.getTime() - DAY_MS).toISOString());
  if (countError) {
    await release(row.id, null);
    throw new Error(countError.message);
  }
  if ((count ?? 0) > OUTSIDE_DAILY_MAX) {
    await release(row.id, null);
    return refused('daily_limit', 429);
  }

  const attachments = await attachmentsOf(row.files);
  if (!attachments) {
    await release(row.id, FAILED_WORDS.file);
    return refused('send_failed', 502, FAILED_WORDS.file);
  }
  const [replyTo, sender] = await Promise.all([
    emailOf(caller.id),
    senderNameOf(job.organization_id),
  ]);
  const person = caller.full_name?.trim() || replyTo?.split('@')[0] || 'A teammate';
  const message = renderOutsideEmail({
    title: row.subject,
    summary: String(row.summary).split('\n').filter(Boolean),
    person,
    workspace: org?.name?.trim() || 'their workspace',
    attached: attachments.length > 0,
  });
  const outcome = await deliverEmailWithId({
    to: [row.to_address],
    ...message,
    fromName: sender,
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length ? { attachments } : {}),
  });
  if (outcome.status !== 'sent') {
    const words = FAILED_WORDS[outcome.status] ?? FAILED_WORDS.refused;
    await release(row.id, words);
    return refused('send_failed', 502, words);
  }
  if (outcome.id) {
    const { error: keepError } = await supabaseAdmin
      .from('chat_outbound_emails')
      .update({ resend_id: outcome.id })
      .eq('id', row.id);
    if (keepError) logger.error({ err: keepError, id: row.id }, 'could not keep Resend’s id');
  }
  await logActivity({ caller, job, row, sent: true });
  await letFilesGo([row.id]);
  return { ok: true };
}

/**
 * Cancel, clicked by `userId`: the e-mail never goes. { ok: true }, or a
 * refusal as sendOutsideEmail's (not_found, forbidden, expired, sent,
 * cancelled, busy).
 * @param {{ userId: string, id: string, now?: Date }} input
 */
export async function cancelOutsideEmail({ userId, id, now = new Date() }) {
  const found = await readForCaller(userId, id);
  if (found.refusal) return found.refusal;
  const { caller, row, job } = found;
  const settled = await settledRefusal(row, now);
  if (settled) return settled;
  const { data: cancelled, error } = await supabaseAdmin
    .from('chat_outbound_emails')
    .update({ status: 'cancelled', send_error: null })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cancelled) return refused('busy', 409);
  await logActivity({ caller, job, row, sent: false });
  await letFilesGo([row.id]);
  return { ok: true };
}

/**
 * The minute sweep: e-mails not sent in their 7 days are `expired`, and
 * their PDFs let go. How many expired now. Never throws.
 */
export async function expireOutsideEmails(now = new Date()) {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_outbound_emails')
      .update({ status: 'expired', send_error: null })
      .eq('status', 'pending')
      .lte('expires_at', now.toISOString())
      .select('id');
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((row) => row.id);
    await letFilesGo(ids);
    return ids.length;
  } catch (err) {
    logger.error({ err }, 'could not expire the outside e-mails');
    return 0;
  }
}
