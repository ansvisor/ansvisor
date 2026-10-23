import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * The Content Agent's runs, step by step (Content Editor v1.1, CE-027 and
 * CE-035; content_agent_runs, 00249): each run says its steps as it reaches
 * them, named by the data they use, so the editor shows real progress; and a
 * person can Stop it, which drops whatever the run had and changes nothing.
 *
 * A step written here is shown, never relied on: a failed write is logged
 * and the run goes on. Stop is the run's own business: the request that
 * stops it aborts the model call when the run is on this server, and the
 * run checks the stopped mark before it keeps anything.
 */

/** Thrown when a run was stopped: nothing it had is kept. */
export class RunStoppedError extends Error {
  constructor() {
    super('The run was stopped');
    this.status = 409;
    this.code = 'stopped';
  }
}

/**
 * How long a run may be under way: the longest model call (three minutes,
 * content-writer.js) and a margin. One older was left by a server that
 * stopped: never shown, stopped or waited on (agent-runs.ts RUN_STALE_MS).
 */
export const RUN_STALE_MS = 10 * 60_000;

/** The runs on this server, by id: Stop aborts their model call. */
const live = new Map();

/** A write a run's progress may do without: logged when it fails, never thrown. */
async function shown(what, runId, write) {
  try {
    const { data, error } = await write();
    if (error) throw error;
    return data;
  } catch (err) {
    logger.warn({ err, runId }, `[content-runs] ${what} not written`);
    return null;
  }
}

/** A run's steps by kind, with the counts the data gives (CE-035). */
export function runSteps(kind, counts = {}) {
  const n = (value) => (Number.isInteger(value) ? value : null);
  switch (kind) {
    case 'fix':
      return [
        { key: 'read_pages', count: n(counts.pages) },
        { key: 'match_fanouts', count: n(counts.fanouts) },
        { key: 'check_queries', count: n(counts.queries) },
        { key: 'write_changes', count: null },
      ];
    case 'rewrite':
      return [
        { key: 'read_sources', count: n(counts.sources) },
        { key: 'rewrite_page', count: n(counts.rules) },
        { key: 'check_rules', count: null },
      ];
    case 'brief':
      return [
        { key: 'read_sources', count: n(counts.sources) },
        { key: 'pick_fanouts', count: null },
        { key: 'write_outline', count: null },
      ];
    default:
      return [
        { key: 'read_sources', count: n(counts.sources) },
        { key: 'write_page', count: null },
        { key: 'check_rules', count: null },
      ];
  }
}

/**
 * Starts a run on a draft: written, with its Stop signal (callSignal adds a
 * call's timeout). Runs a stopped server left on the draft are closed first,
 * so the latest is this one. A run that can't be written still runs, with no
 * steps shown and Stop by its signal only.
 */
export async function startRun({ draftId, kind, counts }) {
  const steps = runSteps(kind, counts);
  const controller = new AbortController();
  await shown('earlier runs', null, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .update({ finished_at: new Date().toISOString(), outcome: 'failed' })
      .eq('draft_id', draftId)
      .is('finished_at', null),
  );
  const data = await shown('run', null, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .insert({ draft_id: draftId, kind, steps })
      .select('id')
      .single(),
  );
  const id = data?.id ?? null;
  if (id) live.set(id, controller);
  return { id, steps, signal: controller.signal };
}

/** A model call's signal: the run's Stop, or the call's own timeout. */
export function callSignal(run, timeoutMs) {
  return AbortSignal.any([run.signal, AbortSignal.timeout(timeoutMs)]);
}

/** Moves a run on to `step`, with counts learned on the way ({ index: count }). */
export async function advanceRun(run, step, counts = {}) {
  if (!run?.id) return;
  for (const [i, count] of Object.entries(counts)) {
    if (run.steps[i]) run.steps[i] = { ...run.steps[i], count };
  }
  await shown('step', run.id, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .update({ step, steps: run.steps })
      .eq('id', run.id)
      .is('finished_at', null),
  );
}

/** Whether the run was stopped (here, or by a request on another server). */
export async function wasStopped(run) {
  if (!run?.id) return false;
  if (live.get(run.id)?.signal.aborted) return true;
  const data = await shown('stop read', run.id, () =>
    supabaseAdmin.from('content_agent_runs').select('stopped_at').eq('id', run.id).maybeSingle(),
  );
  return Boolean(data?.stopped_at);
}

/** Throws RunStoppedError when the run was stopped: before anything is kept. */
export async function stopIfStopped(run) {
  if (await wasStopped(run)) throw new RunStoppedError();
}

/** Ends a run: done (every step), stopped, or failed. */
export async function finishRun(run, outcome, counts = {}) {
  if (!run?.id) return;
  live.delete(run.id);
  for (const [i, count] of Object.entries(counts)) {
    if (run.steps[i]) run.steps[i] = { ...run.steps[i], count };
  }
  await shown('end', run.id, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .update({
        finished_at: new Date().toISOString(),
        outcome,
        steps: run.steps,
        ...(outcome === 'done' ? { step: run.steps.length } : {}),
      })
      .eq('id', run.id)
      .is('finished_at', null),
  );
}

/**
 * Stops a draft's run under way: marks it stopped and aborts its model call
 * when it runs here. Answers whether one was under way.
 */
export async function stopDraftRun(draftId) {
  const { data, error } = await supabaseAdmin
    .from('content_agent_runs')
    .update({ stopped_at: new Date().toISOString() })
    .eq('draft_id', draftId)
    .is('finished_at', null)
    .is('stopped_at', null)
    .gt('started_at', new Date(Date.now() - RUN_STALE_MS).toISOString())
    .select('id');
  if (error) throw error;
  for (const { id } of data ?? []) live.get(id)?.abort();
  return (data ?? []).length > 0;
}

/**
 * Whether a run ended by its Stop: the stopped mark, or its model call
 * aborted by one (whatever error the provider wraps the abort in). Read
 * before finishRun, which forgets the run.
 */
export function isStop(err, run) {
  return (
    err instanceof RunStoppedError ||
    (Boolean(run?.id) && live.get(run.id)?.signal.aborted === true)
  );
}
