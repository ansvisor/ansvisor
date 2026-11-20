import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';

/**
 * Each notification e-mail once (00556): a sender claims a row for the kind,
 * the person and the subject before it sends, and marks it sent after. Two
 * runs at once, or one after a restart, find the claim and send nothing.
 */

const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

/**
 * Claims one e-mail: true when this call may send it, false when it was
 * claimed before. A database without 00556 claims nothing (and so sends
 * nothing): without a record of what went, an e-mail could go twice.
 * @param {{ kind: string, userId: string, brandId?: string|null, subject: string }} send
 */
export async function claimSend({ kind, userId, brandId = null, subject }) {
  const { data, error } = await supabaseAdmin
    .from('notification_sends')
    .upsert(
      { kind, user_id: userId, brand_id: brandId, subject },
      { onConflict: 'kind,user_id,subject', ignoreDuplicates: true },
    )
    .select('id');
  if (error) {
    if (MISSING_TABLE.has(error.code)) {
      logger.warn({ code: error.code }, '[notifications] no notification_sends table yet');
      return false;
    }
    throw new Error(`notification_sends: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/** Marks a claimed e-mail sent. A failure is logged: the claim already keeps it from going twice. */
export async function markSent({ kind, userId, subject }) {
  const { error } = await supabaseAdmin
    .from('notification_sends')
    .update({ sent_at: new Date().toISOString() })
    .eq('kind', kind)
    .eq('user_id', userId)
    .eq('subject', subject);
  if (error) logger.warn({ err: error, kind }, '[notifications] could not mark an e-mail sent');
}

/** The UTC day of `at`, "2026-11-20": a summary's key. */
export const dayKey = (at = new Date()) => new Date(at).toISOString().slice(0, 10);

/** The Monday of `at`'s UTC week, "2026-11-16": a weekly summary's key. */
export function weekKey(at = new Date()) {
  const day = new Date(at);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return dayKey(day);
}
