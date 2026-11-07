import { createTranslator } from 'next-intl';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { ASK_TOOL } from './asks';
import type { ChatModels } from './engine-model';
import {
  clientStep,
  insertStep,
  loadRun,
  moveRun,
  newProgress,
  saveState,
  updateStep,
  type LoadedRun,
  type RunEventSink,
  type RunProgress,
} from './engine-store';
import type { ChatStepPart } from './events';
import { fitResult, toJson } from './fit';
import { NEXT_MOVES_TOOL } from './next-moves';
import { PARTS_TOOL } from './partial-limit';
import type { ChatTool } from './registry/define-tool';
import { CHAT_RUN_STEP_SELECT, toClientStep, type ChatRunStepMemberRow } from './steps';
import { partOf, partsEnded } from './subtask-parts';

/**
 * A run that splits its work into parts (CHAT-27 phase 1, §A–C): the model
 * calls run_subtasks with 2–5 parts, each a title and an instruction, and
 * each part runs as a child run of this one (chat_runs.parent_run_id and
 * subtask_title, 00419) through the engine's own driver, at the same time,
 * in this request. The parent shows one step, "Working on N parts", with each
 * part's status and its own steps, and waits for them all; then it answers
 * from what they found.
 *
 *   - One level: a part is never offered run_subtasks (its model can't call
 *     a tool it isn't given), and the database's trigger refuses a part of a
 *     part (00419). Twice a run at most (READ_CAPS), so at most 10 parts;
 *     the trigger checks that too.
 *   - A part is the parent's person, role, mode, brand, page context and
 *     connections, never more. It only reads, on the reading model, and
 *     asks nothing: a change it finds is needed comes back in its answer,
 *     and the parent makes it with its own tool, under the parent's mode,
 *     so its card shows in the parent's chat (item 4).
 *   - Slots: each part claims a run slot as any run does (chat_claim_run_slot,
 *     CHAT-20 §14), so a split never runs more than the workspace's and the
 *     person's limits allow, the parent's own slot included. As many parts
 *     run at once as slots are free; the rest wait queued and start as slots
 *     free up. A part frees its slot as it ends (done, failed, stopped or at
 *     the cap). One that never got a slot before the parent's time is up is
 *     stopped and named: it couldn't start, the workspace was busy.
 *   - Budget: a part's steps are held on the chat's agent run like the
 *     parent's (reserve_chat_ai_usage, 00419), so the parent and its parts
 *     share the run's cap. A part refused at the cap pauses, and the parent
 *     starts no more parts, waits for the rest and pauses at the cap too.
 *   - Time: 5 minutes a part, and a minute left for the answer in the
 *     request (RUN_REQUEST_MS); a part still working then is stopped.
 *   - Stop: the parent's Stop stops every part.
 *
 * Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.subtasks' });
const stepT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.step' });

export const SUBTASKS_TOOL = 'run_subtasks';
export const MIN_PARTS = 2;
export const MAX_PARTS = 5;
/** How long a part may work (CHAT-27 item 5). */
export const PART_WAIT_MS = 5 * 60_000;
/** What the parent keeps of its request to write the answer once the parts are done. */
export const ANSWER_ROOM_MS = 60_000;
/** The least time worth splitting a run in. */
const MIN_SPLIT_MS = 30_000;
/** How often the parent shows where its parts are, and keeps itself alive. */
const POLL_MS = 2_000;
/** How often a part that found no free slot asks again. */
export const SLOT_POLL_MS = 1_000;
/** A part's answer, as the parent reads it, at most. */
export const PART_ANSWER_MAX = 4_000;

export const subtasksInput = z.object({
  parts: z
    .array(
      z.object({
        title: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe('A short title the person sees, such as "Competitor C".'),
        instruction: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .describe('What this part does on its own: what to read, and what to report back.'),
      }),
    )
    .min(MIN_PARTS)
    .max(MAX_PARTS),
});
export type SubtasksInput = z.output<typeof subtasksInput>;

// ─── A part of a run ────────────────────────────────────────────────────────

/** The tools a part is offered: reads only, never run_subtasks (CHAT-27 items 2–3). */
export function partTools(parentRunId: string | null, tools: ChatTool[]): ChatTool[] {
  if (!parentRunId) return tools;
  return tools.filter((tool) => tool.class === 'read' && tool.name !== SUBTASKS_TOOL);
}

/** A part's tool set: no question, no parts check and no next moves, as nobody reads it. */
export function partToolSet(set: ToolSet): ToolSet {
  const rest = { ...set };
  for (const name of [ASK_TOOL, PARTS_TOOL, NEXT_MOVES_TOOL]) delete rest[name];
  return rest;
}

/** A part reads and answers with the reading model (CHAT-27 item 2). */
export function partModels(models: ChatModels): ChatModels {
  return { ...models, pick: () => models.pick('read') };
}

/**
 * A part's question: its own instruction, the person's request for context,
 * and what a part may do. Model-facing words, in English like the rules.
 */
export function partQuestion(
  asked: string | undefined,
  part: { title: string; instruction: string },
  at: number,
  of: number,
): string {
  return [
    `Part ${at} of ${of} of a bigger request, worked on at the same time as the others: "${part.title}".`,
    `Your part: ${part.instruction}`,
    ...(asked ? [`The person's whole request, for context only: "${asked}"`] : []),
    'Read what this part needs, then answer with what you found: short, specific, with the figures you read. If something could not be read, say what and why. You can only read: if the request needs a change (a draft, prompts, a task), make none, and say exactly what to change. The main run makes it, with the person’s approval.',
  ].join('\n\n');
}

// ─── The parent ─────────────────────────────────────────────────────────────

/** The parent's progress, as the engine keeps it: its question and page context too. */
export type ParentProgress = RunProgress & { question?: string; scope?: unknown };

/** What the parent lends its parts: the engine's run, driver and Stop. */
export interface SubtasksHost {
  run: Pick<
    LoadedRun,
    'id' | 'conversationId' | 'organizationId' | 'userId' | 'mode' | 'model' | 'effort'
  >;
  progress: ParentProgress;
  sink: Pick<RunEventSink, 'emit'>;
  signal: AbortSignal;
  /** When the request working the parent reaches its limit (RUN_REQUEST_MS). */
  endsAt: number;
  /**
   * Starts a queued part when a run slot is free (the engine's claimRunSlot on
   * the workspace's plan): true when it is now running.
   */
  claim(runId: string): Promise<boolean>;
  /** What the parts' answers may take of the run's data budget, in characters. */
  room: number;
  /** In the reading phase, the writer reads the parts' answers from the read log. */
  logRead: boolean;
  /** Works a part to its end (the engine's driveRun, with the parent's session). */
  drive(runId: string): Promise<void>;
  /** Stops a part (the engine's stopChatRun). */
  stop(runId: string): Promise<void>;
}

export type SubtasksOutcome =
  | { kind: 'result'; value: Json; error: boolean; untrusted: boolean; source: string }
  /** A part was refused at the cap: the parent pauses there too. */
  | { kind: 'cap'; limit: 'run' | 'month' }
  /** The parent was stopped, and its parts with it. */
  | { kind: 'stopped' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The parts' runs, made in order into `ids`, queued until each starts. */
async function makeParts(host: SubtasksHost, input: SubtasksInput, ids: string[]): Promise<void> {
  for (const [i, part] of input.parts.entries()) {
    const { data, error } = await supabaseAdmin
      .from('chat_runs')
      .insert({
        message_id: null,
        conversation_id: host.run.conversationId,
        status: 'queued',
        model: host.run.model,
        effort: host.run.effort,
        parent_run_id: host.run.id,
        subtask_title: part.title,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`Chat could not make a part: ${error?.message ?? 'no row'}`);
    const id = (data as { id: string }).id;
    ids.push(id);
    const { progress } = host;
    const partProgress: ParentProgress = {
      ...newProgress(progress.timezone, progress.brandId, 'read'),
      question: partQuestion(progress.question, part, i + 1, input.parts.length),
      ...(progress.scope ? { scope: progress.scope } : {}),
      // What the parent read outside the workspace's numbers taints its parts too.
      ...(progress.tainted ? { tainted: true } : {}),
      // A job's parts are metered as the job's (CHAT-12 item 14).
      ...(progress.scheduled ? { scheduled: true } : {}),
    };
    const { error: stateError } = await supabaseAdmin.from('chat_run_state').insert({
      run_id: id,
      organization_id: host.run.organizationId,
      user_id: host.run.userId,
      mode: host.run.mode,
      progress: partProgress as unknown as Json,
      heartbeat_at: new Date().toISOString(),
    });
    if (stateError) throw new Error(`Chat could not keep a part: ${stateError.message}`);
  }
}

/** The parts as their runs and steps are now, in order. */
export async function readParts(ids: readonly string[]): Promise<ChatStepPart[]> {
  if (ids.length === 0) return [];
  const [runs, steps] = await Promise.all([
    supabaseAdmin
      .from('chat_runs')
      .select('id, status, subtask_title')
      .in('id', [...ids]),
    supabaseAdmin
      .from('chat_run_steps')
      .select(CHAT_RUN_STEP_SELECT)
      .in('run_id', [...ids])
      .order('position', { ascending: true }),
  ]);
  if (runs.error) throw new Error(`Chat could not read the parts: ${runs.error.message}`);
  if (steps.error) throw new Error(`Chat could not read the parts' steps: ${steps.error.message}`);
  const byId = new Map(
    ((runs.data ?? []) as { id: string; status: string; subtask_title: string | null }[]).map(
      (run) => [run.id, run],
    ),
  );
  return ids.map((id) => {
    const rows = ((steps.data ?? []) as unknown as ChatRunStepMemberRow[]).filter(
      (row) => row.run_id === id,
    );
    return partOf({
      title: byId.get(id)?.subtask_title ?? '…',
      status: byId.get(id)?.status ?? 'running',
      steps: rows.map(toClientStep).filter((step) => step !== null),
    });
  });
}

/**
 * Starts the parts in order, each once it claims a run slot, until each has
 * ended; none starts after one was refused at the cap, or after the
 * parent's Stop or the time is up. What never started is returned.
 */
async function workParts(
  host: SubtasksHost,
  ids: readonly string[],
  until: number,
): Promise<{ capped: boolean; unstarted: string[] }> {
  const waiting = [...ids];
  const working = new Map<string, Promise<void>>();
  let capped = false;
  const open = () => !capped && !host.signal.aborted && Date.now() < until;
  // A part that just paused at the cap has freed its slot before its driver returns: no
  // part starts after it, even in that moment.
  const pausedNow = async () => {
    if (working.size === 0) return false;
    const { data } = await supabaseAdmin
      .from('chat_runs')
      .select('status')
      .in('id', [...working.keys()]);
    return ((data ?? []) as { status: string }[]).some((run) => run.status === 'paused_cap');
  };
  const work = async (id: string) => {
    await host.drive(id).catch((err) => console.error('[chat/subtasks] a part failed:', err));
    // Its slot is free once it isn't running: a driver that left it running ends it here.
    await moveRun(id, ['running'], 'error', { error: 'failed', finished: true }).catch(() => {});
    const run = await loadRun(id).catch(() => null);
    if (run?.status === 'paused_cap') capped = true;
    working.delete(id);
  };
  while (waiting.length > 0 || working.size > 0) {
    // As many as there are free slots, in order.
    while (waiting.length > 0 && open()) {
      if (await pausedNow()) {
        capped = true;
        break;
      }
      if (!(await host.claim(waiting[0]))) break;
      const id = waiting.shift()!;
      working.set(id, work(id));
    }
    if (working.size === 0 && !open()) break;
    // A part ends, or a slot may have freed up elsewhere.
    await Promise.race([...working.values(), sleep(SLOT_POLL_MS)]);
  }
  return { capped, unstarted: waiting };
}

/** What a part answered, as the parent's model reads it. */
function partResult(
  part: ChatStepPart,
  run: LoadedRun | null,
  at: number,
  { timedOut, started }: { timedOut: boolean; started: boolean },
): Record<string, Json> {
  const text = (run?.progress.text ?? '').trim();
  const answer = text.length > PART_ANSWER_MAX ? `${text.slice(0, PART_ANSWER_MAX)}…` : text;
  const status = !started
    ? 'not_started'
    : part.status === 'stopped' && timedOut
      ? 'timed_out'
      : part.status;
  const reasons: Record<string, string> = {
    not_started: "It couldn't start: the workspace was busy.",
    timed_out: 'It took longer than its time.',
    failed: 'It stopped on an error.',
  };
  return {
    part: at,
    title: part.title,
    status,
    ...(answer ? { answer } : {}),
    ...(reasons[status] ? { reason: reasons[status] } : {}),
  };
}

/** The parts' sources, freshest data and outside text are the parent's too (CHAT-27 item 9). */
function takeParts(progress: ParentProgress, runs: (LoadedRun | null)[]) {
  for (const run of runs) {
    if (!run) continue;
    for (const [label, rows] of Object.entries(run.progress.sources ?? {})) {
      progress.sources[label] = (progress.sources[label] ?? 0) + rows;
    }
    const asOf = run.progress.dataAsOf;
    if (asOf && (!progress.dataAsOf || asOf > progress.dataAsOf)) progress.dataAsOf = asOf;
    if (run.progress.tainted) progress.tainted = true;
    if (run.progress.injection) progress.injection = true;
  }
}

/**
 * The run_subtasks call (CHAT-27 §A): makes the parts, works them, shows
 * them on one step, and answers the model with what each found; or pauses
 * the parent at the cap, or stops it.
 */
export async function runSubtasks(
  host: SubtasksHost,
  input: SubtasksInput,
): Promise<SubtasksOutcome> {
  const source = t('source');
  const failed = (value: Json): SubtasksOutcome => ({
    kind: 'result',
    value,
    error: true,
    untrusted: false,
    source,
  });
  const until = Math.min(Date.now() + PART_WAIT_MS, host.endsAt - ANSWER_ROOM_MS);
  if (until - Date.now() < MIN_SPLIT_MS) {
    return failed({ code: 'no_time', message: t('noTime') });
  }
  const { progress, sink } = host;
  progress.reads += 1;
  const counts = progress.toolReads ?? {};
  progress.toolReads = { ...counts, [SUBTASKS_TOOL]: (counts[SUBTASKS_TOOL] ?? 0) + 1 };

  const count = input.parts.length;
  const ids: string[] = [];
  try {
    await makeParts(host, input, ids);
  } catch (err) {
    // The parts made so far never start.
    console.error('[chat/subtasks] could not make the parts:', err);
    for (const id of ids) await moveRun(id, ['queued'], 'stopped', { finished: true });
    return failed({ code: 'failed' });
  }

  let row = await insertStep(host.run.id, {
    position: ++progress.steps,
    kind: 'read',
    status: 'running',
    label: t('label', { count }),
    detail: t('progress', { ended: 0, count }),
    scope: { unit: 'parts' },
    rowCount: count,
    tool: SUBTASKS_TOOL,
    debug: { input: input as unknown as Record<string, unknown> },
  });
  let shown = await readParts(ids);
  sink.emit('step.started', { step: { ...clientStep(row), parts: shown } });

  // Each part's Stop with the parent's (item 6), and with the time.
  let stopping = false;
  const stopAll = async () => {
    if (stopping) return;
    stopping = true;
    for (const id of ids) await host.stop(id).catch(() => {});
  };
  const onAbort = () => void stopAll();
  host.signal.addEventListener('abort', onAbort, { once: true });

  const state: { worked: { capped: boolean; unstarted: string[] } | null } = { worked: null };
  const working = workParts(host, ids, until).then((done) => {
    state.worked = done;
  });
  let timedOut = false;
  try {
    while (!state.worked) {
      await Promise.race([working, sleep(POLL_MS)]);
      if (!state.worked && Date.now() >= until) {
        timedOut = true;
        await stopAll();
      }
      // Where the parts are, when it changed; the parent's heartbeat either way.
      const parts = await readParts(ids).catch(() => shown);
      if (JSON.stringify(parts) !== JSON.stringify(shown)) {
        shown = parts;
        row = await updateStep(row.id, {
          detail: t('progress', { ended: partsEnded(parts), count }),
        });
        sink.emit('step.updated', { step: { ...clientStep(row), parts } });
      }
      await saveState(host.run.id, {}).catch(() => {});
    }
  } finally {
    host.signal.removeEventListener('abort', onAbort);
  }
  // Parts that never started (after the cap, a Stop, or the time with no free slot) end
  // as stopped, never left queued; one paused at the cap stays paused, as its parent does.
  for (const id of ids) await moveRun(id, ['queued'], 'stopped', { finished: true });
  const unstarted = new Set(state.worked?.unstarted ?? []);

  const runs = await Promise.all(ids.map((id) => loadRun(id).catch(() => null)));
  const parts = await readParts(ids).catch(() => shown);
  takeParts(progress, runs);
  const finishStep = async (patch: Parameters<typeof updateStep>[1]) => {
    row = await updateStep(row.id, patch);
    sink.emit('step.finished', { step: { ...clientStep(row), parts } });
  };

  if (host.signal.aborted) {
    await finishStep({ status: 'skipped', detail: stepT('stopped') });
    return { kind: 'stopped' };
  }
  if (state.worked?.capped) {
    const limit = runs.find((run) => run?.status === 'paused_cap')?.progress.capHit ?? 'run';
    await finishStep({ status: 'skipped', detail: stepT('pausedCap') });
    return { kind: 'cap', limit };
  }

  const done = parts.filter((part) => part.status === 'done').length;
  await finishStep({
    status: done > 0 ? 'done' : 'error',
    detail: t('progress', { ended: partsEnded(parts), count }),
  });
  const value = toJson({
    parts: parts.map((part, i) =>
      partResult(part, runs[i], i + 1, { timedOut, started: !unstarted.has(ids[i]) }),
    ),
    note: 'Write one answer from these parts. Name each part that failed, timed out or never started, and why; the others still count. Where a part says a change is needed, make it with its tool: the person approves it in this chat.',
  });
  const fitted = fitResult(value, Math.max(500, host.room));
  progress.dataChars += fitted.chars;
  const untrusted = runs.some((run) => run?.progress.tainted === true);
  if (host.logRead) {
    progress.readLog.push({
      tool: SUBTASKS_TOOL,
      input: toJson(input),
      result: fitted.value,
      source,
      untrusted,
    });
  }
  return { kind: 'result', value: fitted.value, error: done === 0, untrusted, source };
}
