import { Marked } from 'marked';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { createContentDraft } from '@/lib/actions/content-drafts';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { readChat } from './conversations';
import type { ChatActor } from './engine';
import { answerFormats, answerTitle, type ExportAnswer } from './export';
import type { StoredChatFile } from './file-export';
import { fileChatOutput } from './file-output';
import { CHAT_FILES_BUCKET } from './files';
import { fileStamp } from './stamp';

/**
 * Answers and chats as files, on the server (CHAT-06 items 30–37): an
 * answer read for its downloads, Save to Files, and Export chat. Filing
 * itself, and the storage it counts against, is file-output's. The rows and the bucket are the server's to write (00411); the
 * person's access is read as them: a chat is theirs or shared with them.
 */

/** The answer's Markdown as a page; the draft's own sanitizing keeps only what a page may hold. */
const draftMarked = new Marked();

const tStamp = createTranslator({ locale: 'en', messages, namespace: 'agentic.resultCard' });

/** A run's answer, as its downloads and Save to Files read it. */
export interface RunAnswerRead {
  answer: ExportAnswer;
  runId: string;
  messageId: string;
  conversationId: string;
  brandId: string | null;
  generatedAt: string;
  dataAsOf: string | null;
  timezone: string | null;
}

/**
 * A finished answer the person may open: their own chat's or one shared
 * with them (readChat, as them). Null for anything else, and for an answer
 * with nothing in it yet. Links to app pages open from the file through
 * `appOrigin`.
 */
export async function readRunAnswer(
  actor: ChatActor,
  runId: string,
  appOrigin: string | null,
): Promise<RunAnswerRead | null> {
  const { data: run, error } = await supabaseAdmin
    .from('chat_runs')
    .select('id, message_id, conversation_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!run?.message_id || !run.conversation_id) return null;
  const chat = await readChat(await createClient(), actor, run.conversation_id);
  if (!chat) return null;

  const [message, conversation] = await Promise.all([
    supabaseAdmin
      .from('chat_messages')
      .select('id, content_md, generated_at, data_as_of, timezone, created_at')
      .eq('id', run.message_id)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_conversations')
      .select('brand_id')
      .eq('id', run.conversation_id)
      .maybeSingle(),
  ]);
  if (message.error) throw new Error(`Could not read the answer: ${message.error.message}`);
  if (conversation.error) throw new Error(`Could not read the chat: ${conversation.error.message}`);
  const answer = message.data;
  if (!answer || !answer.content_md.trim()) return null;

  // The question is the person's message just before the answer.
  const { data: asked, error: askedError } = await supabaseAdmin
    .from('chat_messages')
    .select('content_md')
    .eq('conversation_id', run.conversation_id)
    .eq('role', 'user')
    .lt('created_at', answer.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (askedError) throw new Error(`Could not read the question: ${askedError.message}`);

  const generatedAt = answer.generated_at ?? answer.created_at;
  return {
    answer: {
      markdown: answer.content_md,
      question: asked?.content_md ?? chat.title ?? '',
      chatTitle: chat.title,
      generatedAt,
      timezone: answer.timezone,
      stamp: fileStamp(
        (key, values) => tStamp(key, values),
        generatedAt,
        answer.data_as_of,
        answer.timezone,
      ),
      appOrigin,
    },
    runId: run.id,
    messageId: answer.id,
    conversationId: run.conversation_id,
    brandId: conversation.data?.brand_id ?? null,
    generatedAt,
    dataAsOf: answer.data_as_of,
    timezone: answer.timezone,
  };
}

export type SaveFileFailure = 'not_found' | 'storage_full' | 'failed';

export type SaveFileResult =
  | { ok: true; file: { id: string; title: string }; already: boolean }
  | { ok: false; failure: SaveFileFailure };

/**
 * Save to Files (items 36–37): the answer filed as a document of the
 * workspace, origin Chat, its Markdown kept and its formats offered later.
 * Once per answer: a filed one answers its file ("In Files").
 */
export async function saveRunAnswer(actor: ChatActor, runId: string): Promise<SaveFileResult> {
  const read = await readRunAnswer(actor, runId, null);
  if (!read) return { ok: false, failure: 'not_found' };

  const { data: filed, error: filedError } = await supabaseAdmin
    .from('chat_files')
    .select('id, title')
    .eq('organization_id', actor.organizationId)
    .eq('message_id', read.messageId)
    .limit(1)
    .maybeSingle();
  if (filedError) throw new Error(`Could not read Files: ${filedError.message}`);
  if (filed) return { ok: true, file: { id: filed.id, title: filed.title }, already: true };

  const title = answerTitle(read.answer).slice(0, 200) || 'Chat answer';
  const filedNow = await fileChatOutput({
    organizationId: actor.organizationId,
    createdBy: actor.userId,
    brandId: read.brandId,
    title,
    type: 'document',
    formats: answerFormats(read.answer.markdown),
    body: new TextEncoder().encode(read.answer.markdown),
    mimeType: 'text/markdown',
    fileName: 'answer.md',
    origin: 'chat',
    conversationId: read.conversationId,
    messageId: read.messageId,
    runId: read.runId,
    generatedAt: read.generatedAt,
    dataAsOf: read.dataAsOf,
    timezone: read.timezone,
  });
  if (!filedNow.ok) return filedNow;
  return { ok: true, file: { id: filedNow.id, title }, already: false };
}

const tChat = createTranslator({ locale: 'en', messages, namespace: 'chatPage' });

/**
 * Export chat (CHAT-23 `chat.export`): the whole chat as one file, each
 * question under "You" and its answer after it, with the time line of its
 * newest answer. The person's own chat or one shared with them; null
 * otherwise, and for a chat with nothing in it.
 */
export async function readChatExport(
  actor: ChatActor,
  chatId: string,
  appOrigin: string | null,
): Promise<ExportAnswer | null> {
  const chat = await readChat(await createClient(), actor, chatId);
  if (!chat) return null;
  const { data: rows, error } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content_md, generated_at, data_as_of, timezone, created_at')
    .eq('conversation_id', chatId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  const said = (rows ?? []).filter((row) => row.content_md.trim());
  if (said.length === 0) return null;
  const markdown = said
    .map((row) =>
      row.role === 'user'
        ? `## ${tChat('you')}\n\n${row.content_md.trim()}`
        : row.content_md.trim(),
    )
    .join('\n\n');
  const last = [...said].reverse().find((row) => row.role === 'assistant') ?? said[said.length - 1];
  const generatedAt = last.generated_at ?? last.created_at;
  return {
    markdown,
    question: chat.title ?? tChat('untitledExport'),
    chatTitle: chat.title,
    generatedAt,
    timezone: last.timezone,
    stamp: fileStamp(
      (key, values) => tStamp(key, values),
      generatedAt,
      last.data_as_of,
      last.timezone,
    ),
    appOrigin,
  };
}

/**
 * A run's n-th deliverable (CHAT-06 item 1), as its card downloads it: the
 * file Chat filed as it made it, its content read from chat-files. Null
 * when the person can't open the run's chat, or there is no such file.
 */
export async function readRunFile(
  actor: ChatActor,
  runId: string,
  n: number,
  appOrigin: string | null,
): Promise<StoredChatFile | null> {
  const { data: run, error } = await supabaseAdmin
    .from('chat_runs')
    .select('conversation_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!run?.conversation_id) return null;
  if (!(await readChat(await createClient(), actor, run.conversation_id))) return null;

  const { data: files, error: filesError } = await supabaseAdmin
    .from('chat_files')
    .select('title, mime_type, formats, storage_path, generated_at, data_as_of, timezone')
    .eq('organization_id', actor.organizationId)
    .eq('run_id', runId)
    .is('message_id', null)
    .order('created_at', { ascending: true });
  if (filesError) throw new Error(`Could not read Files: ${filesError.message}`);
  const file = (files ?? [])[n - 1];
  if (!file) return null;

  const { data: blob, error: downloadError } = await supabaseAdmin.storage
    .from(CHAT_FILES_BUCKET)
    .download(file.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Could not read the file: ${downloadError?.message ?? 'missing'}`);
  }
  return {
    title: file.title,
    mimeType: file.mime_type,
    formats: file.formats,
    generatedAt: file.generated_at,
    timezone: file.timezone,
    stamp: fileStamp(
      (key, values) => tStamp(key, values),
      file.generated_at,
      file.data_as_of,
      file.timezone,
    ),
    content: await blob.text(),
    appOrigin,
  };
}

/**
 * Open in Content Editor on an answer (CHAT-06 item 6, CHAT-25): a new
 * Content draft with the answer as its page, in the chat's brand (or the
 * brand the person has open, for a chat about none), marked on the
 * answer's file when it is in Files ("Used in Content draft"). The draft is
 * made as the person (createContentDraft: their plan and the demo brand's
 * rule). Null for an answer they can't open.
 */
export async function answerToDraft(
  actor: ChatActor,
  runId: string,
  fallbackBrandId: string | null,
): Promise<{ draftId: string } | { failure: 'not_found' | 'no_brand' }> {
  const read = await readRunAnswer(actor, runId, null);
  if (!read) return { failure: 'not_found' };
  const brandId = read.brandId ?? fallbackBrandId;
  if (!brandId) return { failure: 'no_brand' };
  const html = draftMarked.parse(read.answer.markdown, { async: false }) as string;
  const draftId = await createContentDraft(brandId, {
    method: 'create',
    title: answerTitle(read.answer).slice(0, MAX_TITLE_LENGTH),
    pageType: 'blog_post',
    typePicked: false,
    source: { kind: 'content' },
    bodyHtml: html.slice(0, MAX_BODY_HTML_LENGTH),
  });
  const { error } = await supabaseAdmin
    .from('chat_files')
    .update({ content_draft_id: draftId })
    .eq('organization_id', actor.organizationId)
    .eq('message_id', read.messageId);
  if (error) console.error('[chat-files] could not mark the file as used:', error.message);
  return { draftId };
}
