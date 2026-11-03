import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';

/**
 * What's new in a run (CHAT-11 item 11): its one step reads "Read What's
 * new · 3 updates for your plan". The engine calls this after
 * get_whats_new's read. Pure.
 */

export const WHATS_NEW_TOOL = 'get_whats_new';

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.whatsNew' });

/** The updates a get_whats_new read returned. */
export function updatesOf(value: unknown): unknown[] {
  const updates = (value as { updates?: unknown } | null)?.updates;
  return Array.isArray(updates) ? updates : [];
}

/** The step's detail: "3 updates for your plan", or "Nothing new for your plan". */
export function whatsNewStepDetail(value: unknown): string {
  return t('step', { count: updatesOf(value).length });
}
