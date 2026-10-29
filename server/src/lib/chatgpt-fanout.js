/**
 * ChatGPT's query fan-out, sampled (CLORO_CHATGPT_FANOUT).
 *
 * Since 2026-09-30 ChatGPT's default (mobile-web) interface carries no query
 * text, so we stopped asking Cloro for it (#1119). Its legacy desktop
 * interface (`legacy: true`) still does, but the fan-out add-on costs +2
 * credits a task, and Cloro calls the legacy interface best-effort and
 * temporary. So by default each prompt's ChatGPT answer asks for it one day a
 * week: that day's answer is the one tracking stores, with no extra request.
 *
 * Modes:
 *   off     never ask
 *   sample  one day a week per prompt (the default)
 *   all     every run
 */

import { createHash } from 'node:crypto';

export const CHATGPT_FANOUT_MODES = ['off', 'sample', 'all'];
export const DEFAULT_CHATGPT_FANOUT_MODE = 'sample';

/** The configured mode. Unset, or a value it doesn't know, is the default. */
export function chatgptFanoutMode(value = process.env.CLORO_CHATGPT_FANOUT) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  return CHATGPT_FANOUT_MODES.includes(mode) ? mode : DEFAULT_CHATGPT_FANOUT_MODE;
}

/**
 * The weekday (0 = Sunday … 6, in UTC, as `getUTCDay` counts) on which a
 * prompt's ChatGPT answer asks for its fan-out. Read from a hash of the
 * prompt's id, so it needs no stored state, never moves, and spreads the
 * prompts (and the cost) across the week.
 */
export function chatgptFanoutWeekday(promptId) {
  return createHash('sha256').update(String(promptId)).digest().readUInt32BE(0) % 7;
}

/** Whether a prompt's ChatGPT task submitted at `date` asks for its fan-out. */
export function chatgptFanoutDue(promptId, date, mode = chatgptFanoutMode()) {
  if (mode === 'all') return true;
  if (mode === 'off') return false;
  return chatgptFanoutWeekday(promptId) === date.getUTCDay();
}
