'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { createClient } from '@/lib/supabase/server';

/**
 * A scheduled job's e-mails to addresses outside the workspace that wait
 * for a click (W4-28, Chat Wave 4 decision 16; chat_outbound_emails,
 * 00467), as the person's Inbox shows them: their own jobs' pending e-mails
 * not past their 7 days, for an Admin or a Manager, read with their session
 * (the table's RLS: as the job is). Send and Cancel go to the API server as
 * them (POST /api/chat-outbound/:id/send | cancel), which checks the role,
 * the plan, the job and the 50 a day again, sends through Resend and logs
 * each one. Behind CHAT_AGENTIC.
 */

/** A prepared e-mail as its Inbox card shows it. */
export interface OutsideEmail {
  id: string;
  to: string;
  subject: string;
  /** The answer's first lines, as the e-mail carries them. */
  summary: string[];
  /** What goes attached (the report's PDF). */
  files: { name: string; bytes: number }[];
  scheduleId: string;
  /** The job's name. */
  title: string;
  createdAt: string;
  expiresAt: string;
  /** Why the last Send didn't go, in plain words. */
  sendError: string | null;
}

/** What a click did: done, or why not (the server's code, and its words for a failed send). */
export type OutsideEmailResult = { ok: true } | { ok: false; code: string; message?: string };

/** The most the Inbox lists at once. */
const OUTSIDE_MAX_LISTED = 20;

/** The person's own jobs' e-mails waiting for a Send; none when they can't be read. */
export async function readOutsideEmails(): Promise<OutsideEmail[]> {
  try {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return [];
    const { data: profile } = await client
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const orgId = profile?.organization_id ?? null;
    if (!orgId || !chatAgenticEnabled(orgId)) return [];
    // Only Admins and Managers send: an Analyst's card would have no button.
    if (profile?.role !== 'admin' && profile?.role !== 'manager') return [];
    const { data: jobs, error: jobsError } = await client
      .from('chat_schedules')
      .select('id, title, external_recipients')
      .eq('organization_id', orgId)
      .eq('created_by', user.id);
    if (jobsError) throw new Error(jobsError.message);
    const withOutside = (jobs ?? []).filter((job) => (job.external_recipients ?? []).length > 0);
    const titles = new Map(withOutside.map((job) => [job.id, job.title]));
    // An address taken off its job since the run waits for nothing: Send would refuse it.
    const kept = new Map(withOutside.map((job) => [job.id, job.external_recipients ?? []]));
    if (titles.size === 0) return [];
    const { data, error } = await client
      .from('chat_outbound_emails')
      .select(
        'id, schedule_id, to_address, subject, summary, files, created_at, expires_at, send_error',
      )
      .in('schedule_id', [...titles.keys()])
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(OUTSIDE_MAX_LISTED);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((row) => kept.get(row.schedule_id)?.includes(row.to_address))
      .map((row) => ({
        id: row.id,
        to: row.to_address,
        subject: row.subject,
        summary: row.summary.split('\n').filter(Boolean),
        files: (Array.isArray(row.files) ? row.files : []).flatMap((file) => {
          const { name, bytes } = (file ?? {}) as { name?: unknown; bytes?: unknown };
          return typeof name === 'string' ? [{ name, bytes: Number(bytes) || 0 }] : [];
        }),
        scheduleId: row.schedule_id,
        title: titles.get(row.schedule_id) ?? row.subject,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        sendError: row.send_error,
      }));
  } catch (err) {
    console.error('[chat/outbound] could not read the e-mails waiting for a Send:', err);
    return [];
  }
}

async function ask(id: string, action: 'send' | 'cancel'): Promise<OutsideEmailResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, code: 'not_found' };
  const client = await createClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return { ok: false, code: 'signed_out' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat-outbound/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    // The read-only workspace: the API refuses every change (402, no code).
    const code = body.code ?? (res.status === 402 ? 'plan' : 'failed');
    return code === 'send_failed' && body.message
      ? { ok: false, code, message: body.message }
      : { ok: false, code };
  } catch (err) {
    console.error(`[chat/outbound] could not ${action} an outside e-mail:`, err);
    return { ok: false, code: 'failed' };
  }
}

/** Send, the person's click: the server sends it as them (above). */
export async function sendOutsideEmail(id: string): Promise<OutsideEmailResult> {
  return ask(id, 'send');
}

/** Cancel: it never goes. */
export async function cancelOutsideEmail(id: string): Promise<OutsideEmailResult> {
  return ask(id, 'cancel');
}
