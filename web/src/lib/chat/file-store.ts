import { randomUUID } from 'node:crypto';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/plan-row';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { readChat } from './conversations';
import type { ChatActor } from './engine';
import { answerFormats, answerTitle, type ExportAnswer } from './export';
import { CHAT_FILES_BUCKET, storageFits, storageLimitBytes, type ChatStorage } from './files';
import { planFactsFromOrgRow, type OrgPlanRow } from './plan-facts';
import { fileStamp } from './stamp';

/**
 * Files on the server (CHAT-06 items 26–37): a workspace's storage as its
 * plan and packs allow, an answer read for its downloads, and Save to
 * Files. The rows and the bucket are the server's to write (00411); the
 * person's access is read as them: a chat is theirs or shared with them.
 */

const tStamp = createTranslator({ locale: 'en', messages, namespace: 'agentic.resultCard' });

/** The workspace's Files: bytes and files kept, and its limit (plan + active storage packs). */
export async function readChatStorage(organizationId: string): Promise<ChatStorage> {
  const now = new Date().toISOString();
  const [org, usage, grants] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_storage_usage')
      .select('bytes_used, file_count')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('storage_grants')
      .select('bytes')
      .eq('organization_id', organizationId)
      .gt('active_until', now),
  ]);
  if (org.error) throw new Error(`Could not read the plan: ${org.error.message}`);
  if (usage.error) throw new Error(`Could not read the storage used: ${usage.error.message}`);
  if (grants.error) throw new Error(`Could not read the storage packs: ${grants.error.message}`);
  const facts = planFactsFromOrgRow((org.data ?? {}) as OrgPlanRow);
  const granted = (grants.data ?? []).reduce((sum, row) => sum + Number(row.bytes ?? 0), 0);
  return {
    usedBytes: Number(usage.data?.bytes_used ?? 0),
    fileCount: Number(usage.data?.file_count ?? 0),
    limitBytes: storageLimitBytes(
      { isTrial: facts.isTrial, maxStorageGb: facts.limits.maxStorageGb },
      granted,
    ),
  };
}

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

/** Something Chat made, to file for the workspace (CHAT-06 item 9). */
export interface ChatOutput {
  organizationId: string;
  createdBy: string | null;
  brandId: string | null;
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  /** The formats it downloads in, its main one first. */
  formats: string[];
  /** The canonical content (CHAT-06 data notes: Markdown for a document) and its type. */
  body: Uint8Array;
  mimeType: string;
  /** Its object's name under {organization}/{file}/. */
  fileName: string;
  origin: 'task' | 'chat' | 'schedule' | 'editor';
  conversationId: string | null;
  messageId: string | null;
  runId: string | null;
  generatedAt: string;
  dataAsOf: string | null;
  timezone: string | null;
}

/**
 * Files something Chat made (CHAT-06 items 9, 26–29): its row, then its
 * content in chat-files. It counts toward storage (the row's trigger), and
 * a full workspace files nothing new. Save to Files files an answer with
 * it; a run's deliverables are filed with it as they are made. Answers as
 * a value; content that didn't go up leaves no row.
 */
export async function fileChatOutput(
  output: ChatOutput,
): Promise<{ ok: true; id: string } | { ok: false; failure: 'storage_full' | 'failed' }> {
  const storage = await readChatStorage(output.organizationId);
  if (!storageFits(storage, output.body.byteLength)) return { ok: false, failure: 'storage_full' };

  const id = randomUUID();
  const path = `${output.organizationId}/${id}/${output.fileName}`;
  const { error: rowError } = await supabaseAdmin.from('chat_files').insert({
    id,
    organization_id: output.organizationId,
    brand_id: output.brandId,
    created_by: output.createdBy,
    title: output.title.slice(0, 200),
    type: output.type,
    formats: output.formats,
    mime_type: output.mimeType,
    storage_path: path,
    size_bytes: output.body.byteLength,
    origin: output.origin,
    conversation_id: output.conversationId,
    message_id: output.messageId,
    run_id: output.runId,
    generated_at: output.generatedAt,
    data_as_of: output.dataAsOf,
    timezone: output.timezone,
  });
  if (rowError) {
    console.error('[chat-files] could not file it:', rowError.message);
    return { ok: false, failure: 'failed' };
  }
  const { error: uploadError } = await supabaseAdmin.storage
    .from(CHAT_FILES_BUCKET)
    .upload(path, output.body, { contentType: output.mimeType, upsert: false });
  if (uploadError) {
    console.error('[chat-files] could not keep its content:', uploadError.message);
    await supabaseAdmin.from('chat_files').delete().eq('id', id);
    return { ok: false, failure: 'failed' };
  }
  return { ok: true, id };
}

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
