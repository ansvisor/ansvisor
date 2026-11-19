/**
 * A page title, as Chat's draft saves need one (create_draft, update_draft):
 * the page's H1, not a line of the chat. Drafts in the Library have been
 * titled with a sentence of Chat's answer ("Here are the opportunities from
 * the last 30 …") or the person's request ("Find content opportunities for
 * topics"). A title like that isn't saved: the model is told to pass a real
 * page title, as the placeholder check (placeholders.ts) tells it. Pure.
 */

/** Longer than this is a sentence, not a title (the editor allows more; a title is short). */
export const MAX_PAGE_TITLE_CHARS = 120;

const CHAT_OPENERS =
  // Only what opens a reply or a request, never a page ("I Tested 10 CRMs",
  // "Find Your Perfect Grinder" are titles).
  /^(here\s+(are|is)|here['’]s|sure|certainly|of course|okay|ok|absolutely|let me|based on|these are|show me|give me|help me|can you|could you|please)\b/i;

/** Why a title isn't a page title, in words for the model; null when it is one. */
export function pageTitleIssue(title: string | undefined): string | null {
  if (title === undefined) return null;
  const text = title.trim();
  let reason: string | null = null;
  if (!text) reason = 'it is empty';
  else if (text.length > MAX_PAGE_TITLE_CHARS) reason = 'it is a long sentence, not a title';
  else if (/(:|…|\.{3})$/.test(text)) reason = 'it is cut off or ends like a lead-in line';
  else if (CHAT_OPENERS.test(text)) reason = 'it reads like a line of the chat, not a page title';
  if (!reason) return null;
  return `Not saved: the title "${text.slice(0, 60)}" is not a page title (${reason}). Pass the real title of the page, the H1 a reader would see on it, not a line of your answer or the person's request.`;
}

/** A schema's superRefine for an input with a `title`. */
export function refuseChatSentenceTitle(
  input: { title?: string },
  ctx: { addIssue: (issue: { code: 'custom'; message: string; path: string[] }) => void },
): void {
  const issue = pageTitleIssue(input.title);
  if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['title'] });
}
