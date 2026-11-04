import { CONTENT_EDITOR_PATH } from '@/lib/content/drafts';

/**
 * The page open in the Content Editor beside the chat (CHAT-25 §4–§5,
 * W4-14): the editor's Chat sends it as a context chip, "This draft", with
 * the draft's id, from the editor's own route. While a message carries it,
 * Chat doesn't change that draft (update_draft): what the person asks comes
 * back as the Content Agent's suggestions there (suggest_draft_changes).
 * Removing the chip stops Chat editing the page. The chip is the page's
 * word, never trusted: the tools check the draft as they always do.
 */

/** The chip's key in a message's context. */
export const DRAFT_CHIP = 'draft';

const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The draft a message's scope has open in the editor, or null. */
export function openDraftOf(
  scope:
    | { context?: { route?: string; chips: { key: string; value?: string }[] } }
    | null
    | undefined,
): string | null {
  const id = scope?.context?.chips.find((chip) => chip.key === DRAFT_CHIP)?.value;
  if (!id || !DRAFT_ID.test(id)) return null;
  // Only from the editor's own page for that draft.
  return scope?.context?.route === `${CONTENT_EDITOR_PATH}/${id}` ? id.toLowerCase() : null;
}
