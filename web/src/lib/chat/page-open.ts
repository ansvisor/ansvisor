import type { ChatDeliverable } from './events';

/**
 * Where a page Chat writes opens (CHAT-25 §3, §12; 00400's page_open):
 * ask each time, keep working in chat, or the Content Editor. "Open here"
 * (the editor inside Chat, W4-15) isn't offered yet: a saved `here` asks.
 */
export const PAGE_OPENS = ['ask', 'chat', 'editor'] as const;
export type PageOpen = (typeof PAGE_OPENS)[number];

/** A saved page_open as Chat reads it now: anything it doesn't offer asks. */
export const pageOpenOf = (value: unknown): PageOpen =>
  PAGE_OPENS.find((p) => p === value) ?? 'ask';

/**
 * The page a run wrote (CHAT-25 §2a, W4-11): its first deliverable that is
 * a Content Library draft, as its Open goes to the editor; null for a run
 * whose result isn't a page (a report, a table, an answer, an image).
 */
export function pageHrefOf(deliverables: readonly ChatDeliverable[]): string | null {
  const page = deliverables.find(
    (deliverable) =>
      deliverable.type === 'document' && deliverable.href?.startsWith('/dashboard/content/editor/'),
  );
  return page?.href ?? null;
}

const KEY = 'aeo:page-open:';

/**
 * Whether the person already answered a run's "Where should we open this
 * page?" card in this browser: the card asks once per page. A storage that
 * can't be read counts as not answered.
 */
export function pageChoiceMade(runId: string): boolean {
  try {
    return window.localStorage.getItem(KEY + runId) !== null;
  } catch {
    return false;
  }
}

/** Keeps that the card of a run was answered, and how. */
export function keepPageChoice(runId: string, where: 'chat' | 'editor'): void {
  try {
    window.localStorage.setItem(KEY + runId, where);
  } catch {
    // A private window: the card may ask again after a reload.
  }
}
