import { readChosenTimeZone } from '@/lib/account-time-zone';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  isChatEventType,
  isChatHref,
  maskIds,
  type ChatDeliverable,
  type ChatHref,
  type ChatNextMove,
  type ChatPageVersion,
  type ChatRunSummary,
  type ChatActionSent,
  type ChatAuditCard,
  type ChatStep,
  type ChatTaskStrip,
  type ChatWhatsNewEntry,
} from './events';
import { withAuditCard } from './audit-card';
import { clientMove } from './next-moves';
import { latestChoice, type ChatModelChoice } from './models';
import { isTourTopic, type TourTopic } from './tour';
import { applyChatEvent, emptyRun } from './run-state';
import { CHAT_RUN_STEP_SELECT, toClientStep, type ChatRunStepMemberRow } from './steps';
import { readDeliverableTasks, readStrips, weekEndIn, type DeliverableTask } from './task-strip';
import { CHAT_UPLOAD_BUCKET, isImageUpload, isUploadType, type SentFile } from './uploads';
import type { WhyResult } from './why/explain';
import { whyView, type ChatWhy } from './why/view';
import type { ChatActor } from './engine';

/**
 * A saved chat as its page opens it (CHAT-01, CHAT-03 item 21): its
 * messages, and each answer's run with the steps as kept (toClientStep: no
 * tool, no debug record). Read as the person, so the chat's policy holds: a
 * chat is its author's only (CHAT-20 §16c). A run still under way is rebuilt
 * by the page from its events (`…/events?after=0`), and keeps streaming. A
 * run that ended keeps what its end event told the browser (W1-15): its
 * header's time, steps and sources, and why it ended in error, in the same
 * words, so a reload shows "Stopped after 41s" and the reason with Retry.
 * A finished run's next moves come back from chat_next_moves, in the
 * person's own chat only; a failed read of them loses the moves, not the chat.
 * A /tasks run's task strip comes back from chat_task_state as it is now
 * (CHAT-09 §B): a task the person completed in Action Center since reads
 * Done; a failed read loses the strip, not the chat. A job with a due time
 * still at work, this chat's own or one made in it, puts its due line under
 * the latest task strip (readReadyBy); a failed read loses the line.
 */

/**
 * A job's due line (CHAT-09 item 8, W4-30): "Due Mon 19 Oct, 09:00 · I'll
 * keep working and notify you", with Change.
 */
export interface ChatReadyBy {
  dueAt: string;
  /** The person's time zone (Settings › Account), else the job's own. */
  timeZone: string;
  /** Change: the job's page at its When, for its creator. */
  href: `/dashboard/chat/scheduled/${string}`;
}

export interface ThreadRun {
  /** The run's handle for its routes (approve, stop, events): the person's own. */
  runId: string;
  status: string;
  steps: ChatStep[];
  /** Its answer in Files (CHAT-06 item 36): "In Files"; null until saved. */
  fileId: string | null;
  /** What it made, as filed (CHAT-06 item 1), in the order it made them. */
  deliverables: ChatDeliverable[];
  /** Its end, as its end event said it (CHAT-03 items 10, 18–19); null while it works. */
  summary: ChatRunSummary | null;
  /** Why it ended in error, in its run.error event's words; null without them. */
  errorReason: string | null;
  /** It ended because the workspace's own AI key failed (run.error `own_key`). */
  keyFailed: boolean;
  /** What could come next once it finished (CHAT-07 §C), best first. */
  nextMoves: ChatNextMove[];
  /** "Remember this?": the line it offered to remember (W4-33); null when none. */
  remember: string | null;
  /** What it sent to the Action Center (CHAT-09 item 19), in order. */
  sent: ChatActionSent[];
  /** The Action Center tasks it worked on (CHAT-09 §B); null when it had none. */
  tasks: ChatTaskStrip | null;
  /** A job with a due time's line under its tasks (W4-30); on one run of the chat at most. */
  readyBy?: ChatReadyBy | null;
  /** The Why did it move analyses it kept (CHAT-22 §1), in order. */
  why: ChatWhy[];
  /** What's new's cards (CHAT-11 item 10). */
  whatsNew: ChatWhatsNewEntry[];
  /** The Site Audits it read, as their cards. */
  audits: ChatAuditCard[];
}

export interface ThreadMessage {
  role: 'user' | 'assistant';
  text: string;
  generatedAt: string | null;
  dataAsOf: string | null;
  timezone: string | null;
  run: ThreadRun | null;
  /**
   * A question Retry may send again as it was (W1-15): one without files
   * (each goes with one message only) and without a page scope (its chips
   * and @ references stay on the server). Questions only.
   */
  resendable?: boolean;
  /**
   * The files the question was sent with (00409), in the order they were
   * attached; none without. An image shows as a thumbnail read through its
   * route (readSentImage), any other file as a chip with its name.
   * Questions only.
   */
  attachments?: SentFile[];
  /**
   * The product tour's topic a line of the tour is about (its context_json,
   * 00486), so the side panel finds the turn about the page on screen.
   * Questions only.
   */
  tour?: TourTopic;
}

export interface ChatThread {
  conversationId: string;
  title: string | null;
  brandId: string | null;
  /** The person's own chat; false for a teammate's shared one, which they only read. */
  mine: boolean;
  messages: ThreadMessage[];
  /**
   * The model and effort its latest run ran with: the composer's model menu
   * starts on it (W4-02). Missing: Auto at Normal.
   */
  choice?: ChatModelChoice;
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

/** A run's end as the browser was told it: the event that ended it. */
const END_EVENTS = ['run.finished', 'run.stopped', 'run.error', 'run.paused_cap'];
/** What a run sent to the Action Center (CHAT-09 item 19), read back with its end. */
const SENT_EVENT = 'action.sent';
/** "Remember this?" (W4-33): the line a finished run offered to remember. */
const REMEMBER_EVENT = 'remember.offered';
/** What's new's cards (CHAT-11 item 10), read back the same way. */
const WHATS_NEW_EVENT = 'whats_new.ready';
/** The Site Audits a run read, as their cards. */
const AUDIT_EVENT = 'audit.ready';
/** A run's next moves as the browser got them: a move that opens a page keeps its link only here. */
const MOVES_EVENT = 'next_moves';
/** A run's deliverables, read back for their page versions (W4-12a), which Files doesn't keep. */
const DELIVERABLE_EVENTS = ['deliverable.created', 'deliverable.updated'];
/** Where a page's card links: the editor. */
const EDITOR_PATH = '/dashboard/content/editor/';

/** What an ended run's events keep: its end, and what it sent to the Action Center. */
interface RunEnd {
  summary: ChatRunSummary | null;
  errorReason: string | null;
  keyFailed: boolean;
  sent: ChatActionSent[];
  remember: string | null;
  /** Its filed pages' versions, in order; null for a page without one (W4-12a). */
  versions: (ChatPageVersion | null)[];
  whatsNew: ChatWhatsNewEntry[];
  audits: ChatAuditCard[];
  /** The links of its moves that open a page, by the move's prompt (W4-12b part 2). */
  moveHrefs: Map<string, ChatHref>;
}
const ENDED: readonly string[] = ['done', 'stopped', 'error', 'paused_cap'];

/**
 * The ended runs' last end events, as the run's answer applies them live
 * (applyChatEvent): the summary, and an error's reason. The events are the
 * server's (chat_run_events: service role only), read here for runs the
 * person already read; each was made safe for the browser when it was sent
 * (chatEvent). A read that fails leaves them out: the chat still opens.
 */
async function readRunEnds(runIds: string[]): Promise<Map<string, RunEnd>> {
  const ends = new Map<string, RunEnd>();
  if (runIds.length === 0) return ends;
  const { data, error } = await supabaseAdmin
    .from('chat_run_events')
    .select('run_id, seq, type, data')
    .in('run_id', runIds)
    .in('type', [
      ...END_EVENTS,
      SENT_EVENT,
      REMEMBER_EVENT,
      WHATS_NEW_EVENT,
      AUDIT_EVENT,
      MOVES_EVENT,
      ...DELIVERABLE_EVENTS,
    ])
    .order('seq', { ascending: true });
  if (error) {
    console.error("[chat/thread] could not read the runs' ends:", error.message);
    return ends;
  }
  for (const row of (data ?? []) as {
    run_id: string;
    seq: number;
    type: string;
    data: unknown;
  }[]) {
    if (!isChatEventType(row.type) || !row.data || typeof row.data !== 'object') continue;
    const kept = ends.get(row.run_id) ?? {
      summary: null,
      errorReason: null,
      keyFailed: false,
      sent: [],
      remember: null,
      versions: [],
      whatsNew: [],
      audits: [],
      moveHrefs: new Map<string, ChatHref>(),
    };
    if (row.type === MOVES_EVENT) {
      const moves = (row.data as { moves?: unknown }).moves;
      const hrefs = new Map<string, ChatHref>();
      for (const move of Array.isArray(moves) ? (moves as Partial<ChatNextMove>[]) : []) {
        if (typeof move?.prompt === 'string' && isChatHref(move.href)) {
          hrefs.set(move.prompt, move.href);
        }
      }
      ends.set(row.run_id, { ...kept, moveHrefs: hrefs });
      continue;
    }
    if (DELIVERABLE_EVENTS.includes(row.type)) {
      // Only a page that reached Files has a file to take its version.
      const made = row.data as ChatDeliverable;
      const page = made.filed === 'in_files' && made.href?.startsWith(EDITOR_PATH);
      ends.set(
        row.run_id,
        page ? { ...kept, versions: [...kept.versions, made.version ?? null] } : kept,
      );
      continue;
    }
    if (row.type === WHATS_NEW_EVENT) {
      const cards = (row.data as { entries?: unknown }).entries;
      ends.set(row.run_id, {
        ...kept,
        whatsNew: Array.isArray(cards) ? (cards as ChatWhatsNewEntry[]) : [],
      });
      continue;
    }
    if (row.type === AUDIT_EVENT) {
      ends.set(row.run_id, {
        ...kept,
        audits: withAuditCard(kept.audits, row.data as ChatAuditCard),
      });
      continue;
    }
    if (row.type === SENT_EVENT) {
      ends.set(row.run_id, { ...kept, sent: [...kept.sent, row.data as ChatActionSent] });
      continue;
    }
    if (row.type === REMEMBER_EVENT) {
      const text = (row.data as { text?: unknown }).text;
      ends.set(row.run_id, { ...kept, remember: typeof text === 'string' ? text : null });
      continue;
    }
    const run = applyChatEvent(emptyRun(), {
      type: row.type,
      seq: row.seq,
      data: row.data,
    } as Parameters<typeof applyChatEvent>[1]);
    ends.set(row.run_id, {
      ...kept,
      summary: run.summary,
      errorReason: run.errorReason,
      keyFailed: run.keyFailed,
    });
  }
  return ends;
}

/** A finished run's next move, as the thread reads it. */
interface NextMoveRow {
  run_id: string;
  rank: number;
  label: string;
  prompt: string;
  ghost_ok: boolean;
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
      .select('id, role, content_md, context_json, generated_at, data_as_of, timezone, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('chat_runs')
      .select('id, message_id, status, model, effort, created_at')
      .eq('conversation_id', conversationId),
  ]);
  if (messages.error) throw new Error(`Could not read the chat: ${messages.error.message}`);
  if (runs.error) throw new Error(`Could not read the chat's runs: ${runs.error.message}`);

  const questionIds = (messages.data ?? []).filter((m) => m.role === 'user').map((m) => m.id);
  const uploads = questionIds.length
    ? await supabase
        .from('chat_uploads')
        .select('id, message_id, name, mime_type, size_bytes, created_at')
        .in('message_id', questionIds)
        .order('created_at', { ascending: true })
    : { data: [], error: null };
  // Unread, every question counts as having files: Retry stays off rather than send it short.
  if (uploads.error)
    console.error('[chat/thread] could not read the files sent:', uploads.error.message);
  const withFiles = new Set(
    uploads.error
      ? questionIds
      : (uploads.data ?? []).map((row) => row.message_id).filter((id): id is string => !!id),
  );
  // Each question's files, as its bubble shows them: a failed read shows none.
  const filesOf = new Map<string, SentFile[]>();
  for (const row of uploads.error ? [] : (uploads.data ?? [])) {
    if (!row.message_id || !row.name || !isUploadType(row.mime_type)) continue;
    filesOf.set(row.message_id, [
      ...(filesOf.get(row.message_id) ?? []),
      { id: row.id, name: row.name, mimeType: row.mime_type, sizeBytes: row.size_bytes },
    ]);
  }

  const runIds = (runs.data ?? []).map((run) => run.id);
  const endedIds = (runs.data ?? []).filter((run) => ENDED.includes(run.status)).map((r) => r.id);
  const mine = !!user && chat.user_id === user.id;
  const [steps, files, ends, moves, whys] = runIds.length
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
        readRunEnds(endedIds),
        // A teammate's shared chat shows no moves: they are the author's to take.
        mine
          ? supabase
              .from('chat_next_moves')
              .select('run_id, rank, label, prompt, ghost_ok')
              .in('run_id', runIds)
              .order('rank', { ascending: true })
          : { data: [], error: null },
        // Readable where the chat is (00420); the card's numbers, never its ids.
        supabase
          .from('chat_why_analyses')
          .select('run_id, scope_json, result_json')
          .in('run_id', runIds)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        new Map(),
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (steps.error) throw new Error(`Could not read the chat's steps: ${steps.error.message}`);
  if (files.error) throw new Error(`Could not read the chat's files: ${files.error.message}`);
  if (moves.error)
    console.error("[chat/thread] could not read the chat's next moves:", moves.error.message);
  const strips = runIds.length
    ? await readThreadStrips(supabase, conversationId, messages.data ?? [], endedIds)
    : new Map<string, ChatTaskStrip>();
  // A failed read of the analyses loses their cards, not the chat.
  if (whys.error)
    console.error("[chat/thread] could not read the chat's Why analyses:", whys.error.message);
  // Each analysis keeps its place in its run (the drawer's route finds it by
  // that n); one that can't be shown is left out, not the chat.
  const whyByRun = new Map<string, ChatWhy[]>();
  const whyCount = new Map<string, number>();
  for (const row of (whys.error ? [] : (whys.data ?? [])) as unknown as {
    run_id: string | null;
    scope_json: Record<string, unknown>;
    result_json: WhyResult;
  }[]) {
    if (!row.run_id) continue;
    const n = (whyCount.get(row.run_id) ?? 0) + 1;
    whyCount.set(row.run_id, n);
    try {
      whyByRun.set(row.run_id, [
        ...(whyByRun.get(row.run_id) ?? []),
        whyView(n, row.result_json, row.scope_json),
      ]);
    } catch (error) {
      console.error('[chat/thread] could not show a Why analysis:', error);
    }
  }
  const movesByRun = new Map<string, ChatNextMove[]>();
  for (const m of (moves.error ? [] : (moves.data ?? [])) as NextMoveRow[]) {
    const href = ends.get(m.run_id)?.moveHrefs.get(m.prompt);
    const move = clientMove({
      label: m.label,
      prompt: m.prompt,
      ghostOk: m.ghost_ok,
      ...(href ? { href } : {}),
    });
    movesByRun.set(m.run_id, [...(movesByRun.get(m.run_id) ?? []), move]);
  }
  // An answer saved to Files names its message; what a run made doesn't.
  const fileByRun = new Map<string, string>();
  const madeByRun = new Map<string, ChatDeliverable[]>();
  const madeIds = ((files.data ?? []) as FileRow[]).filter((f) => f.run_id && !f.message_id);
  const tasksOfFiles = await readFileTasks(
    supabase,
    conversationId,
    madeIds.map((f) => f.id),
  );
  // Each run's page versions, in the order its pages were filed (W4-12a).
  const versionsLeft = new Map([...ends].map(([runId, end]) => [runId, [...end.versions]]));
  for (const f of (files.data ?? []) as FileRow[]) {
    if (!f.run_id) continue;
    if (f.message_id) {
      fileByRun.set(f.run_id, f.id);
      continue;
    }
    // Each page the run filed takes its next version, in order.
    const version = f.content_draft_id ? versionsLeft.get(f.run_id)?.shift() : undefined;
    madeByRun.set(f.run_id, [
      ...(madeByRun.get(f.run_id) ?? []),
      {
        title: maskIds(f.title),
        type: f.type,
        formats: f.formats,
        status: f.status,
        ...(f.content_draft_id ? { href: `${EDITOR_PATH}${f.content_draft_id}` } : {}),
        filed: 'in_files',
        ...(tasksOfFiles.has(f.id) ? { task: tasksOfFiles.get(f.id) } : {}),
        ...(version ? { version } : {}),
      },
    ]);
  }
  const stepsByRun = new Map<string, ChatStep[]>();
  for (const row of (steps.data ?? []) as unknown as ChatRunStepMemberRow[]) {
    const step = toClientStep(row);
    if (step) stepsByRun.set(row.run_id, [...(stepsByRun.get(row.run_id) ?? []), step]);
  }
  // Its due line goes under the latest strip, else under the run that made the job.
  const readyBy =
    mine && user ? await readReadyBy(supabase, conversationId, runIds, user.id) : null;
  const ordered = (messages.data ?? [])
    .map((m) => (runs.data ?? []).find((run) => run.message_id === m.id)?.id)
    .filter((id): id is string => !!id);
  const readyByRun = readyBy
    ? ([...ordered].reverse().find((id) => (strips.get(id)?.total ?? 0) > 0) ??
      (readyBy.setByRunId && ordered.includes(readyBy.setByRunId)
        ? readyBy.setByRunId
        : ordered.at(-1)))
    : undefined;
  const runByMessage = new Map(
    (runs.data ?? []).map((run) => [
      run.message_id,
      {
        runId: run.id,
        status: run.status,
        steps: stepsByRun.get(run.id) ?? [],
        fileId: fileByRun.get(run.id) ?? null,
        deliverables: madeByRun.get(run.id) ?? [],
        summary: ends.get(run.id)?.summary ?? null,
        errorReason: ends.get(run.id)?.errorReason ?? null,
        keyFailed: ends.get(run.id)?.keyFailed ?? false,
        nextMoves: movesByRun.get(run.id) ?? [],
        // The author's own chat only, as the moves.
        remember: mine ? (ends.get(run.id)?.remember ?? null) : null,
        sent: ends.get(run.id)?.sent ?? [],
        tasks: strips.get(run.id) ?? null,
        ...(readyBy && run.id === readyByRun ? { readyBy: readyBy.line } : {}),
        why: whyByRun.get(run.id) ?? [],
        whatsNew: ends.get(run.id)?.whatsNew ?? [],
        audits: ends.get(run.id)?.audits ?? [],
      },
    ]),
  );

  return {
    conversationId: chat.id,
    title: chat.title,
    brandId: chat.brand_id,
    mine,
    choice: latestChoice(runs.data ?? []),
    messages: (messages.data ?? []).map((message) => ({
      role: message.role as 'user' | 'assistant',
      text: message.content_md,
      generatedAt: message.generated_at,
      dataAsOf: message.data_as_of,
      timezone: message.timezone,
      run: runByMessage.get(message.id) ?? null,
      ...(message.role === 'user'
        ? { resendable: !message.context_json && !withFiles.has(message.id) }
        : {}),
      ...(message.role === 'user' && filesOf.has(message.id)
        ? { attachments: filesOf.get(message.id)! }
        : {}),
      ...(message.role === 'user' && tourTopicOf(message.context_json)
        ? { tour: tourTopicOf(message.context_json)! }
        : {}),
    })),
  };
}

/**
 * The chat's task strips, by run, read as the person: "due this week" in the
 * zone its latest answer was shown in (the run's), else UTC. A run that has
 * ended is writing nothing: a task it still has Writing (an Undo of Ready for
 * review put it back, or the run never reached its own end) reads Queued.
 */
async function readThreadStrips(
  db: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  messages: readonly { role: string; timezone: string | null }[],
  endedRunIds: readonly string[],
): Promise<Map<string, ChatTaskStrip>> {
  const zone =
    [...messages].reverse().find((m) => m.role === 'assistant' && m.timezone)?.timezone ?? 'UTC';
  try {
    const strips = await readStrips(db, conversationId, weekEndIn(new Date(), zone));
    for (const runId of endedRunIds) {
      for (const task of strips.get(runId)?.tasks ?? []) {
        if (task.status === 'writing') task.status = 'queued';
      }
    }
    return strips;
  } catch (err) {
    console.error("[chat/thread] could not read the chat's task strip:", err);
    return new Map();
  }
}

/**
 * The person's job with a due time that is still at work (not delivered,
 * due later, on or paused at the AI limit), when it is this chat's own or
 * was made in it; the newest one. Read as the person; null when none.
 */
async function readReadyBy(
  db: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  runIds: readonly string[],
  userId: string,
): Promise<{ line: ChatReadyBy; setByRunId: string | null } | null> {
  try {
    const { data, error } = await db
      .from('chat_schedules')
      .select('id, due_at, timezone, conversation_id, set_by_run_id, enabled, paused_reason')
      .eq('created_by', userId)
      .eq('kind', 'once')
      .eq('run_mode', 'ready_by')
      .not('next_run_at', 'is', null)
      .gt('due_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    const job = (
      (data ?? []) as {
        id: string;
        due_at: string;
        timezone: string;
        conversation_id: string | null;
        set_by_run_id: string | null;
        enabled: boolean;
        paused_reason: string | null;
      }[]
    ).find(
      (row) =>
        (row.enabled || row.paused_reason === 'cap') &&
        (row.conversation_id === conversationId ||
          (!!row.set_by_run_id && runIds.includes(row.set_by_run_id))),
    );
    if (!job) return null;
    return {
      line: {
        dueAt: job.due_at,
        timeZone: (await readChosenTimeZone(userId)) ?? job.timezone,
        href: `/dashboard/chat/scheduled/${job.id}#schedule-when`,
      },
      setByRunId: job.set_by_run_id,
    };
  } catch (err) {
    console.error("[chat/thread] could not read the chat's due line:", err);
    return null;
  }
}

/** The tasks of the chat's deliverables (CHAT-09 item 12), read as the person; a failed read loses them, not the chat. */
async function readFileTasks(
  db: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  fileIds: string[],
): Promise<Map<string, DeliverableTask>> {
  try {
    return await readDeliverableTasks(db, conversationId, fileIds);
  } catch (err) {
    console.error("[chat/thread] could not read the deliverables' tasks:", err);
    return new Map();
  }
}

/** The tour topic a message's scope names (the product tour's lines); null for any other. */
function tourTopicOf(context: unknown): TourTopic | null {
  const topic =
    context && typeof context === 'object' ? (context as { tour?: unknown }).tour : null;
  return isTourTopic(topic) ? topic : null;
}

/**
 * An image a message was sent with, for its thumbnail (GET
 * /api/chat/uploads/{id}): read as the person, so it is their own or one of
 * a chat they can read (00409's policy), in their workspace, up and an
 * image; its bytes from the private bucket. Null for anything else.
 */
export async function readSentImage(
  actor: ChatActor,
  uploadId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const { data, error } = await (await createClient())
    .from('chat_uploads')
    .select('storage_path, mime_type')
    .eq('id', uploadId)
    .eq('organization_id', actor.organizationId)
    .eq('status', 'ready')
    .maybeSingle();
  if (error) throw new Error(`Could not read the file: ${error.message}`);
  if (!data || !isImageUpload(data.mime_type)) return null;
  const { data: blob, error: readError } = await supabaseAdmin.storage
    .from(CHAT_UPLOAD_BUCKET)
    .download(data.storage_path);
  // Gone from the bucket (the 90-day sweep): as a file that isn't there.
  if (readError || !blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: data.mime_type };
}
