/** A new chat started, or why it couldn't be: the API's code and words, when it said. */
export type StartedChat =
  | { ok: true; chatId: string }
  | { ok: false; code: string | null; error: string | null };

/**
 * Starts a new chat with `message` (POST /api/chat/runs) on the brand open, or
 * carries on `conversationId` when given (What's new, askInOneChat),
 * in the person's own time zone: Chat Home's suggestions and shortcuts
 * (W2-09: the shortcut's id goes with it) and a skill's Run on the Skills
 * page (W3-07). The run goes on without the page; its stream
 * is let go once the chat's id is known, and the chat picks it up. Client
 * only. Never throws.
 */
export async function startChatRun(
  message: string,
  brandId: string | null,
  { shortcutId, conversationId }: { shortcutId?: string; conversationId?: string } = {},
): Promise<StartedChat> {
  const res = await fetch('/api/chat/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      // In an existing chat, the chat's own brand is used.
      ...(conversationId ? { conversationId } : { brandId: brandId ?? undefined }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(shortcutId ? { shortcutId } : {}),
    }),
  }).catch(() => null);
  const chatId = res?.ok ? res.headers.get('x-chat-conversation') : null;
  if (!res?.ok || !chatId) {
    const body = (await res?.json().catch(() => null)) as {
      code?: string;
      error?: string;
    } | null;
    return { ok: false, code: body?.code ?? null, error: body?.error ?? null };
  }
  void res.body?.cancel().catch(() => undefined);
  return { ok: true, chatId };
}

/**
 * The chat a repeated question goes back to (What's new): the person's own
 * newest chat it started, for the brand open; null when there is none or
 * it can't be read, and the question starts a new chat. Never throws.
 */
export async function findAskAgainChat(
  message: string,
  brandId: string | null,
): Promise<string | null> {
  const params = new URLSearchParams({ message });
  if (brandId) params.set('brandId', brandId);
  const res = await fetch(`/api/chat/conversations/ask-again?${params}`, {
    cache: 'no-store',
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    | { ok: true; id: string | null }
    | { ok: false }
    | null;
  return res?.ok && body?.ok ? body.id : null;
}

/**
 * Asks a question that has one chat (What's new, from the profile menu and
 * Chat Home): in that chat when the person has one, so asking again doesn't
 * add a chat each time; else in a new chat. Never throws.
 */
export async function askInOneChat(message: string, brandId: string | null): Promise<StartedChat> {
  const conversationId = await findAskAgainChat(message, brandId);
  return startChatRun(message, brandId, conversationId ? { conversationId } : {});
}
