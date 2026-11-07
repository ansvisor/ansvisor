import { PANEL_FROM_PARAM } from './panel';

/**
 * Chat's Open here (CHAT-25 §4, W4-15): a page open in the Content Editor
 * beside the conversation. Which page is the chat's address, `?page={draftId}`,
 * as `?from=` keeps where a full-page chat came from (panel.ts): a reload or a
 * shared link opens it again, and Close takes it out. No React here: the
 * shell lays the two out, PagePane shows the editor.
 */

/** The chat page's query parameter for the page open beside it. */
export const PAGE_PARAM = 'page';

/** The conversation beside a page: about 420px wide, never under this. */
export const CHAT_BESIDE_PAGE_MIN = 300;

/** The editor's room beside the chat; narrower, its toolbar folds into More (W4-13b). */
export const PAGE_PANE_MIN = 600;

/**
 * Narrower than this (the chat's 300px and the editor's 600px), the two
 * can't sit side by side: the page takes the whole width, with Back to
 * chat (Teknik T1).
 */
export const SPLIT_MIN = CHAT_BESIDE_PAGE_MIN + PAGE_PANE_MIN;

const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The draft `?page=` names, or null for none or anything that isn't a
 * draft's id. Never trusted beyond its shape: the editor reads the draft as
 * the person, and one they can't read is "not found" there.
 */
export function openPageOf(value: string | null | undefined): string | null {
  return value && DRAFT_ID.test(value) ? value.toLowerCase() : null;
}

/**
 * An address's query (`location.search`) with the open page set, or taken
 * out for none (Close); the rest of the query stays as it was.
 */
export function withOpenPage(search: string, draftId: string | null): string {
  const params = new URLSearchParams(search);
  if (draftId) params.set(PAGE_PARAM, draftId);
  else params.delete(PAGE_PARAM);
  const query = params.toString();
  return query ? `?${query}` : '';
}

const EDITOR_HREF = /^\/dashboard\/content\/editor\/([^/?#]+)/;

/** The draft a page's Content Editor address (`/dashboard/content/editor/{draftId}`) names, or null. */
export function draftOfEditorHref(href: string): string | null {
  return openPageOf(EDITOR_HREF.exec(href)?.[1]);
}

/**
 * Open here from outside the chat's own page (the side panel, W4-15b): the
 * chat's full page with the draft beside it, and `?from=` the page the
 * person was on, as the panel's Open as full page keeps it (CHAT-22).
 */
export function chatWithPageHref(chatId: string, draftId: string, from?: string | null): string {
  const params = new URLSearchParams();
  if (from) params.set(PANEL_FROM_PARAM, from);
  params.set(PAGE_PARAM, draftId);
  return `/dashboard/chat/${chatId}?${params.toString()}`;
}
