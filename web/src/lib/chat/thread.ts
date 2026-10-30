import { createClient } from '@/lib/supabase/server';
import type { ChatDeliverable, ChatStep } from './events';
import { CHAT_RUN_STEP_SELECT, toClientStep, type ChatRunStepMemberRow } from './steps';

/**
 * A saved chat as its page opens it (CHAT-01, CHAT-03 item 21): its
 * messages, and each answer's run with the steps as kept (toClientStep: no
 * tool, no debug record). Read as the person, so the chat's policy holds: a
 * chat is its author's only (CHAT-20 §16c). A run still under way is rebuilt
 * by the page from its events (`…/events?after=0`), and keeps streaming.
 */

export interface ThreadRun {
  /** The run's handle for its routes (approve, stop, events): the person's own. */
  runId: string;
  status: string;
  steps: ChatStep[];
  /** Its answer in Files (CHAT-06 item 36): "In Files"; null until saved. */
  fileId: string | null;
  /** What it made, as filed (CHAT-06 item 1), in the order it made them. */
  deliverables: ChatDeliverable[];
}

export interface ThreadMessage {
  role: 'user' | 'assistant';
  text: string;
  generatedAt: string | null;
  dataAsOf: string | null;
  timezone: string | null;
  run: ThreadRun | null;
}

export interface ChatThread {
  conversationId: string;
  title: string | null;
  brandId: string | null;
  /** The person's own chat; false for a teammate's shared one, which they only read. */
  mine: boolean;
  messages: ThreadMessage[];
}

/** A file in Files the chat's runs made or saved, as the thread reads it. */
interface FileRow {
  id: string;
  run_id: string | null;
  message_id: string | null;
  title: string;
  type: ChatDeliverable['type'];
  formats: string[];
  status: ChatDeliverable['status'];
  content_draft_id: string | null;
}

/** The person's chat with its messages and runs; null when it isn't theirs or isn't there. */
export async function loadChatThread(conversationId: string): Promise<ChatThread | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: chat, error } = await supabase
    .from('chat_conversations')
    .select('id, title, brand_id, user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  if (!chat) return null;

  const [messages, runs] = await Promise.all([
    supabase
      .from('chat_messages')
      .select('id, role, content_md, generated_at, data_as_of, timezone, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('chat_runs')
      .select('id, message_id, status')
      .eq('conversation_id', conversationId),
  ]);
  if (messages.error) throw new Error(`Could not read the chat: ${messages.error.message}`);
  if (runs.error) throw new Error(`Could not read the chat's runs: ${runs.error.message}`);

  const runIds = (runs.data ?? []).map((run) => run.id);
  const [steps, files] = runIds.length
    ? await Promise.all([
        supabase
          .from('chat_run_steps')
          .select(CHAT_RUN_STEP_SELECT)
          .in('run_id', runIds)
          .order('position', { ascending: true }),
        supabase
          .from('chat_files')
          .select('id, run_id, message_id, title, type, formats, status, content_draft_id')
          .in('run_id', runIds)
          .order('created_at', { ascending: true }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (steps.error) throw new Error(`Could not read the chat's steps: ${steps.error.message}`);
  if (files.error) throw new Error(`Could not read the chat's files: ${files.error.message}`);
  // An answer saved to Files names its message; what a run made doesn't.
  const fileByRun = new Map<string, string>();
  const madeByRun = new Map<string, ChatDeliverable[]>();
  for (const f of (files.data ?? []) as FileRow[]) {
    if (!f.run_id) continue;
    if (f.message_id) {
      fileByRun.set(f.run_id, f.id);
      continue;
    }
    madeByRun.set(f.run_id, [
      ...(madeByRun.get(f.run_id) ?? []),
      {
        title: f.title,
        type: f.type,
        formats: f.formats,
        status: f.status,
        ...(f.content_draft_id ? { href: `/dashboard/content/editor/${f.content_draft_id}` } : {}),
        filed: 'in_files',
      },
    ]);
  }
  const stepsByRun = new Map<string, ChatStep[]>();
  for (const row of (steps.data ?? []) as unknown as ChatRunStepMemberRow[]) {
    const step = toClientStep(row);
    if (step) stepsByRun.set(row.run_id, [...(stepsByRun.get(row.run_id) ?? []), step]);
  }
  const runByMessage = new Map(
    (runs.data ?? []).map((run) => [
      run.message_id,
      {
        runId: run.id,
        status: run.status,
        steps: stepsByRun.get(run.id) ?? [],
        fileId: fileByRun.get(run.id) ?? null,
        deliverables: madeByRun.get(run.id) ?? [],
      },
    ]),
  );

  return {
    conversationId: chat.id,
    title: chat.title,
    brandId: chat.brand_id,
    mine: !!user && chat.user_id === user.id,
    messages: (messages.data ?? []).map((message) => ({
      role: message.role as 'user' | 'assistant',
      text: message.content_md,
      generatedAt: message.generated_at,
      dataAsOf: message.data_as_of,
      timezone: message.timezone,
      run: runByMessage.get(message.id) ?? null,
    })),
  };
}
