import type { PlanFacts } from '../plan-facts';
import type { ScheduleReader } from './views';

/**
 * A scheduled job's addresses outside the workspace (W4-28, Chat Wave 4
 * decision 16; chat_schedules.external_recipients, 00467): its runs only
 * prepare their e-mails, and someone clicks Send on each in the Inbox
 * (the API server sends: chat-outbound-email.js). Only Admins and Managers
 * add them, at most 5 a job, not in the free trial (Starter and up). Pure.
 */

/** Outside addresses a job keeps at most (00467 checks it too). */
export const OUTSIDE_MAX = 5;

/** An address as 00467 keeps it: lowercase, one address, 254 characters at most. */
const ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** An address typed, as it is kept: trimmed and lowercase; null when it isn't one. */
export function outsideAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  return address.length <= 254 && ADDRESS.test(address) ? address : null;
}

/**
 * Why the reader can't add an outside address now: `role` for an Analyst or
 * an Agency partner, `trial` in the free trial; null when they can.
 * Self-hosted, billing doesn't apply.
 */
export function outsideLockOf(
  reader: Pick<ScheduleReader, 'role'>,
  plan: Pick<PlanFacts, 'isTrial' | 'selfHosted'> | null,
): 'role' | 'trial' | null {
  if (reader.role !== 'admin' && reader.role !== 'manager') return 'role';
  if (!plan || (!plan.selfHosted && plan.isTrial)) return 'trial';
  return null;
}

export type OutsideRefusal = 'outside_role' | 'outside_trial' | 'outside_max' | 'outside_invalid';

/**
 * A job's addresses after an edit, checked: each one an address, once,
 * at most 5; a new one only by an Admin or a Manager, out of the trial.
 * Taking one off is anyone's who edits the job.
 */
export function readOutsideEdit(
  kept: readonly string[],
  typed: readonly string[],
  lock: 'role' | 'trial' | null,
): { ok: true; addresses: string[] } | { ok: false; reason: OutsideRefusal } {
  const addresses: string[] = [];
  for (const value of typed) {
    const address = outsideAddress(value);
    if (!address) return { ok: false, reason: 'outside_invalid' };
    if (!addresses.includes(address)) addresses.push(address);
  }
  if (addresses.length > OUTSIDE_MAX) return { ok: false, reason: 'outside_max' };
  const added = addresses.some((address) => !kept.includes(address));
  if (added && lock)
    return { ok: false, reason: lock === 'role' ? 'outside_role' : 'outside_trial' };
  return { ok: true, addresses };
}
