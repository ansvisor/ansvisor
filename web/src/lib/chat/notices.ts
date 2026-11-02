import { isKeyFailureClass, type KeyFailureClass } from '@/lib/agent/key-errors';
import { isAiProvider, type AiProvider } from '@/lib/agent/providers';

/**
 * A person's notices from the system (00441) as the Inbox shows them: their
 * workspace's own AI key fails (AGENT-OWN-KEY §5.3), or its agents reached
 * 80% or all of their monthly limit on it (§4.2 item 4, PR 10). Pure, for
 * the server action that reads them (lib/actions/chat-notices.ts).
 */

interface NoticeBase {
  id: string;
  createdAt: string;
  read: boolean;
}

/** A notice as the Inbox shows it. */
export type ChatNotice =
  | (NoticeBase & {
      kind: 'own_key_failed';
      provider: AiProvider;
      class: KeyFailureClass;
      /** The 3-day reminder of a key still failing. */
      reminder: boolean;
    })
  | (NoticeBase & {
      kind: 'own_key_limit';
      /** 80: agents used 80% of the limit; 100: all of it, and they paused. */
      level: 80 | 100;
      /** This month's estimate when the notice was written, at list prices. */
      usedUsd: number;
      capUsd: number;
      renewsAt: string | null;
    });

/** A row as the Inbox reads it: its kind, what the words need, and whether it was read. */
export interface NoticeRow {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

/** The notice a row is, or null for one this Inbox can't show (another kind, a broken payload). */
export function noticeOf(row: NoticeRow): ChatNotice | null {
  const base = { id: row.id, createdAt: row.created_at, read: row.read_at !== null };
  const payload = row.payload ?? {};
  if (row.kind === 'own_key_failed') {
    const { provider, class: cls, reminder } = payload;
    if (!isAiProvider(provider) || !isKeyFailureClass(cls)) return null;
    return { ...base, kind: 'own_key_failed', provider, class: cls, reminder: reminder === true };
  }
  if (row.kind === 'own_key_limit_80' || row.kind === 'own_key_limit_100') {
    const usedUsd = Number(payload.usedUsd);
    const capUsd = Number(payload.capUsd);
    if (!Number.isFinite(usedUsd) || !Number.isFinite(capUsd)) return null;
    return {
      ...base,
      kind: 'own_key_limit',
      level: row.kind === 'own_key_limit_100' ? 100 : 80,
      usedUsd,
      capUsd,
      renewsAt: typeof payload.renewsAt === 'string' ? payload.renewsAt : null,
    };
  }
  return null;
}
