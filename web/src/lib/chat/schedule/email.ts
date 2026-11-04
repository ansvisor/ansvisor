import { after } from 'next/server';
import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { LoadedRun } from '../engine-store';
import { answerFileName, type ExportAnswer } from '../export';
import { fileStamp } from '../stamp';

/**
 * A scheduled job's e-mails (CHAT-12 items 19, 26; W3-04b), handed to the
 * server (POST /api/internal/chat/schedules/email, CRON_SECRET), which
 * checks the recipients as it sends — the creator and the workspace's
 * people the job names, still members, still reaching its brand — and
 * sends through Resend, from "Ansvisor" or the white label kit's company:
 *
 *   - a run that is done (not "No change"), for a job that delivers by
 *     e-mail: its answer as a PDF, the one the answer's own Download › PDF
 *     makes, attached up to 5 MB; a bigger one goes as the Open in Chat
 *     link only;
 *   - a run that didn't run after its retry, and a job that turned itself
 *     off: why, sent once, as its Inbox notice.
 *
 * In the background (next/server's after()), so a run's row moves on
 * whatever the e-mail does. Never throws. Server only.
 */

/** The largest report attached (Wave 3 decision 3): a bigger one goes as the link. */
export const PDF_ATTACH_MAX_BYTES = 5 * 1024 * 1024;
/** How long the server may take: a send per recipient, with a PDF. */
const SEND_TIMEOUT_MS = 60_000;

const tStamp = createTranslator({ locale: 'en', messages, namespace: 'agentic.resultCard' });

/** after() in a request; outside one (a script, a test), on its own. */
function inBackground(task: () => Promise<void>) {
  const guarded = () =>
    task().catch((err) => console.error('[chat/schedules] an e-mail failed:', err));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

interface EmailBody {
  orgId: string;
  scheduleId: string;
  runId?: string | null;
  kind: 'result' | 'failed' | 'paused';
  reason?: string;
  attachment?: { filename: string; content: string } | null;
}

/** Hands an e-mail to the server; false when it didn't take it. */
async function post(body: EmailBody): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/schedules] CRON_SECRET must be configured for scheduled e-mails');
    return false;
  }
  const res = await fetch(`${API_BASE_URL}/api/internal/chat/schedules/email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) console.error('[chat/schedules] the server didn’t send an e-mail:', res.status);
  return res.ok;
}

/** A job as its e-mail reads it: whether it delivers by e-mail. */
async function readEmailJob(
  jobId: string,
): Promise<{ id: string; organization_id: string; title: string; deliver_to: string[] } | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .select('id, organization_id, title, deliver_to')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a scheduled job: ${error.message}`);
  return (
    (data as { id: string; organization_id: string; title: string; deliver_to: string[] }) ?? null
  );
}

/**
 * The run's answer as its PDF (the answer's own Download › PDF), named as
 * that download names it; null with nothing in it, or past 5 MB.
 */
export async function reportPdf(
  messageId: string,
  title: string,
): Promise<{ filename: string; content: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('content_md, generated_at, data_as_of, timezone, created_at')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a run's answer: ${error.message}`);
  const message = data as {
    content_md: string;
    generated_at: string | null;
    data_as_of: string | null;
    timezone: string | null;
    created_at: string;
  } | null;
  if (!message?.content_md?.trim()) return null;
  const generatedAt = message.generated_at ?? message.created_at;
  const answer: ExportAnswer = {
    markdown: message.content_md,
    question: title,
    chatTitle: title,
    generatedAt,
    timezone: message.timezone,
    stamp: fileStamp(
      (key, values) => tStamp(key, values),
      generatedAt,
      message.data_as_of,
      message.timezone,
    ),
  };
  // The PDF writer (fonts, react-pdf) loads only when a job e-mails.
  const { answerPdf } = await import('../export-pdf');
  const bytes = await answerPdf(answer);
  if (bytes.byteLength === 0 || bytes.byteLength > PDF_ATTACH_MAX_BYTES) return null;
  return {
    filename: answerFileName(answer, 'pdf'),
    content: Buffer.from(bytes).toString('base64'),
  };
}

/**
 * A run that is done goes by e-mail, for a job that delivers by e-mail
 * (above), with its report attached when it fits. In the background.
 */
export function emailRunResult(
  run: { id: string; schedule_id: string },
  chat: Pick<LoadedRun, 'messageId'>,
): void {
  inBackground(async () => {
    const job = await readEmailJob(run.schedule_id);
    if (!job || !(job.deliver_to ?? []).includes('email')) return;
    let attachment: EmailBody['attachment'] = null;
    try {
      attachment = await reportPdf(chat.messageId, job.title);
    } catch (err) {
      // No PDF: the e-mail still goes, with its Open in Chat link.
      console.error('[chat/schedules] could not make a run’s PDF:', err);
    }
    await post({
      orgId: job.organization_id,
      scheduleId: job.id,
      runId: run.id,
      kind: 'result',
      attachment,
    });
  });
}

/**
 * A run that didn't run after its retry (`failed`, its run row's id), or a
 * job that turned itself off (`paused`), by e-mail for a job that delivers
 * by e-mail, with why. In the background.
 */
export function emailJobProblem(
  jobId: string,
  kind: 'failed' | 'paused',
  reason: string,
  runRowId: string | null = null,
): void {
  inBackground(async () => {
    const job = await readEmailJob(jobId);
    if (!job || !(job.deliver_to ?? []).includes('email')) return;
    await post({
      orgId: job.organization_id,
      scheduleId: job.id,
      runId: runRowId,
      kind,
      reason: reason.slice(0, 200),
    });
  });
}
