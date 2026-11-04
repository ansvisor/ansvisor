import { restoreDraftVersion } from '@/lib/actions/content-drafts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  cutSection,
  pageChanges,
  pageCounts,
  pagePlaceholders,
  pageSections,
} from '@/lib/content/page-version';
import type { ChatPageVersion } from './events';

/** The most sections a version card carries for Show all. */
export const VERSION_SECTIONS = 30;

/** A page's version as the write that made it read it, and whether the draft is Ready or published. */
export interface PageVersionRead {
  title: string;
  version: ChatPageVersion;
  undoVersionId: string | null;
  /** Ready or published already: no "Mark ready" move after it (W4-12b). */
  done: boolean;
}

/**
 * A page's version in a chat (CHAT-25 §6, W4-12a), read as the write that
 * made it ends: its number (1 + the versions of it this chat already filed:
 * the page Chat made is 1), its counts, what changed since the page before
 * (History's version the change kept, `beforeVersionId`; a new page has
 * none, only its placeholders), and its sections. Read with the service
 * role: the run already wrote the draft. A change to a page this chat
 * didn't make counts that page as version 1. Null when it can't be read.
 */
export async function readPageVersion(input: {
  draftId: string;
  conversationId: string;
  beforeVersionId?: string | null;
}): Promise<PageVersionRead | null> {
  const { draftId, conversationId, beforeVersionId } = input;
  const [draft, filed, before] = await Promise.all([
    supabaseAdmin
      .from('content_drafts')
      .select('title, body_html, status')
      .eq('id', draftId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_files')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('content_draft_id', draftId),
    beforeVersionId
      ? supabaseAdmin
          .from('content_draft_versions')
          .select('body_html')
          .eq('id', beforeVersionId)
          .eq('draft_id', draftId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const read of [draft, filed, before]) {
    if (read.error) {
      console.error('[chat/versions] could not read a page version:', read.error.message);
      return null;
    }
  }
  if (!draft.data) return null;
  const body = draft.data.body_html ?? '';
  return {
    title: draft.data.title ?? '',
    version: {
      // A change follows the page before it: version 1 when it came from elsewhere (the Library).
      n: beforeVersionId ? Math.max(filed.count ?? 0, 1) + 1 : (filed.count ?? 0) + 1,
      counts: pageCounts(body),
      changes: beforeVersionId
        ? pageChanges(before.data?.body_html ?? '', body)
        : { shortened: [], added: [], placeholders: pagePlaceholders(body) },
      sections: pageSections(body).slice(0, VERSION_SECTIONS).map(cutSection),
      ...(beforeVersionId ? { canUndo: true } : {}),
    },
    undoVersionId: beforeVersionId ?? null,
    done: draft.data.status === 'ready' || draft.data.status === 'published',
  };
}

export type PageUndoResult = { ok: true } | { ok: false; reason: 'not_found' | 'failed' };

/**
 * A version card's Undo (W4-12a): the n-th file the run made, in the
 * person's own chat, goes back to the page before it, as the editor's
 * History restores it (restoreDraftVersion: as the person, so row-level
 * security and a read-only workspace decide). Which History version that
 * is, the run kept on the server when it filed the page (pageUndos).
 */
export async function undoPageVersion(
  actor: { userId: string; organizationId: string },
  runId: string,
  n: number,
): Promise<PageUndoResult> {
  const notFound = { ok: false as const, reason: 'not_found' as const };
  const { data: run, error } = await supabaseAdmin
    .from('chat_runs')
    .select('conversation_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!run?.conversation_id) return notFound;
  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chat_conversations')
    .select('user_id, organization_id')
    .eq('id', run.conversation_id)
    .maybeSingle();
  if (chatError) throw new Error(`Could not read the chat: ${chatError.message}`);
  if (!chat || chat.user_id !== actor.userId || chat.organization_id !== actor.organizationId) {
    return notFound;
  }
  const [files, state] = await Promise.all([
    supabaseAdmin
      .from('chat_files')
      .select('id')
      .eq('organization_id', actor.organizationId)
      .eq('run_id', runId)
      .is('message_id', null)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('chat_run_state').select('progress').eq('run_id', runId).maybeSingle(),
  ]);
  if (files.error || state.error) {
    throw new Error(`Could not read the run's files: ${(files.error ?? state.error)!.message}`);
  }
  const file = ((files.data ?? []) as { id: string }[])[n - 1];
  const progress = state.data?.progress as {
    pageUndos?: Record<string, { draftId: string; versionId: string }>;
  } | null;
  const undo = file ? progress?.pageUndos?.[file.id] : undefined;
  if (!undo) return notFound;
  try {
    await restoreDraftVersion(undo.draftId, undo.versionId);
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'not_found') return notFound;
    throw err;
  }
}
