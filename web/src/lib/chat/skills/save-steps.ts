import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ChatStepKind, ChatStepScope } from '../events';
import type { NextMoveInput } from '../next-moves';

/**
 * "Save these steps as a skill" (CHAT-13 item 13, W4-32): a next move after
 * a finished chat that did real work, for whoever may save a skill. Its
 * click sends its prompt; that run gets the steps the chat ran, in order
 * with the scope each read, and drafts save_skill's card from them (W3-08):
 * the scopes become defaults, numbers and customer data are left out, and
 * nothing is kept before Save.
 */

/** The steps that are the chat's work: what it read, checked, opened or changed. */
const WORK_KINDS: ReadonlySet<ChatStepKind> = new Set([
  'read',
  'open_page',
  'check',
  'write',
  'execute',
]);

/** At least this many done work steps: a single read isn't a way of working worth keeping. */
export const MIN_STEPS_TO_SAVE = 2;

/** The most steps a draft is built from: a long run's first ones. */
export const MAX_STEPS_TO_SAVE = 12;

/** A step of the run as it is read back. */
export interface RunStepRow {
  kind: ChatStepKind;
  status: string;
  label: string;
  tool: string | null;
  scope_json: ChatStepScope | null;
}

/** One step for the draft: its words, the tool behind it, and the scope that becomes a default. */
export interface StepToSave {
  label: string;
  tool: string | null;
  subject?: string;
  dateRange?: string;
  platforms?: string[];
}

/** A date range that holds for any run ("Last 30 days", "All time"), not one run's dates. */
const RELATIVE_RANGE = /^(last|all time|this|today|yesterday|past)\b/i;

/** Figures out of a step's words: "Top 10 prompts" → "Top # prompts". */
const noFigures = (text: string) => text.replace(/\d[\d,.]*%?/g, '#');

const workDone = (steps: readonly RunStepRow[]) =>
  steps.filter((step) => step.status === 'done' && WORK_KINDS.has(step.kind));

/**
 * Whether a finished run's steps are worth the move: two done work steps
 * or more, and the run didn't save a skill itself.
 */
export function offersSaveSteps(steps: readonly RunStepRow[]): boolean {
  if (steps.some((step) => step.tool === 'save_skill')) return false;
  return workDone(steps).length >= MIN_STEPS_TO_SAVE;
}

/**
 * The model's moves with this one in third place (or last, with fewer):
 * it takes the place of a move of the same kind (reuse) or prompt, so the
 * three shown still differ in kind (pickNextMoves).
 */
export function withSaveStepsMove(
  moves: readonly NextMoveInput[],
  words: { label: string; prompt: string },
): NextMoveInput[] {
  const prompt = words.prompt.toLowerCase();
  const rest = moves.filter(
    (move) => move.kind !== 'reuse' && move.prompt.trim().toLowerCase() !== prompt,
  );
  const move: NextMoveInput = {
    label: words.label,
    prompt: words.prompt,
    kind: 'reuse',
    class: 'write',
  };
  const at = Math.min(2, rest.length);
  return [...rest.slice(0, at), move, ...rest.slice(at)];
}

/**
 * The done work steps a draft is built from, in order: each step's words
 * and tool, its subject and platforms, and its date range only when it
 * holds for any run. The brand and figures are left out.
 */
export function stepsToSave(steps: readonly RunStepRow[]): StepToSave[] {
  return workDone(steps)
    .slice(0, MAX_STEPS_TO_SAVE)
    .map((step) => {
      const scope = step.scope_json ?? {};
      return {
        label: noFigures(step.label),
        tool: step.tool,
        ...(scope.subject ? { subject: noFigures(scope.subject) } : {}),
        ...(scope.dateRange && RELATIVE_RANGE.test(scope.dateRange)
          ? { dateRange: scope.dateRange }
          : {}),
        ...(scope.platforms?.length ? { platforms: scope.platforms } : {}),
      };
    });
}

/** A run's steps, in order. Throws when they can't be read. */
export async function readRunSteps(runId: string): Promise<RunStepRow[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_run_steps')
    .select('kind, status, label, tool, scope_json')
    .eq('run_id', runId)
    .order('position', { ascending: true });
  if (error) throw new Error(`Chat could not read the run's steps: ${error.message}`);
  return (data ?? []) as unknown as RunStepRow[];
}

/**
 * The steps to save for a message that is this move's prompt: the steps of
 * the chat's latest run that offered it. Null for another message, or when
 * no run of the chat offered it; a read that fails is null too (the run
 * then drafts from the chat alone).
 */
export async function stepsToSaveFor(
  conversationId: string,
  message: string,
  prompt: string,
): Promise<StepToSave[] | null> {
  if (message.trim().toLowerCase() !== prompt.toLowerCase()) return null;
  try {
    const runs = await supabaseAdmin
      .from('chat_runs')
      .select('id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false });
    if (runs.error) throw new Error(runs.error.message);
    const runIds = ((runs.data ?? []) as { id: string }[]).map((run) => run.id);
    if (runIds.length === 0) return null;
    const moves = await supabaseAdmin
      .from('chat_next_moves')
      .select('run_id')
      .in('run_id', runIds)
      .eq('prompt', prompt);
    if (moves.error) throw new Error(moves.error.message);
    const offered = new Set(((moves.data ?? []) as { run_id: string }[]).map((m) => m.run_id));
    const source = runIds.find((id) => offered.has(id));
    if (!source) return null;
    const steps = stepsToSave(await readRunSteps(source));
    return steps.length > 0 ? steps : null;
  } catch (err) {
    console.error('[chat/skills] could not read the steps to save:', err);
    return null;
  }
}
