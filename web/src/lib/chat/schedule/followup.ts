import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isTimeZone, zonedInstant, dayIn } from '@/lib/time-zone';
import { readPrecedenceContext } from '../precedence-context';
import { dateWords, type WhenWords } from './when';

/**
 * Follow-up checks (CHAT-20 §13, CHAT-12 v2; W3-05): a one-time re-check of
 * a target on a date — citations for a page, prompts on their platforms, an
 * Action Center action — kept as a scheduled job of kind followup_check.
 * The check reads scheduled tracking data only (the server's evaluator,
 * impact-ledger/follow-up.js), never asks an engine or a model: no extra
 * cost. Its result goes to the chat that set it and the creator's Inbox.
 *
 *   - Set by a person's click (Set check) in Ask me first and Auto, or by
 *     itself in Full auto (logged, with Undo until it runs; Growth and up).
 *   - Set by an agent run that shipped something, its version's follow-up
 *     days after (openAgentFollowUps).
 *   - At most 3 a run (run-limits.ts); they don't count toward the plan's
 *     active scheduled jobs.
 *
 * Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatFollowUps' });
const whenT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatSchedules.when',
}) as unknown as WhenWords;

/** The days a check may be set out (CHAT-22 §2's checkpoints, and any day to 90). */
export const FOLLOW_UP_MAX_DAYS = 90;
/** Most prompts a check reads. */
export const FOLLOW_UP_MAX_PROMPTS = 20;
/** When on its day a check is due: 09:00 on the person's clock, as a day with no time (CHAT-12 item 3). */
const CHECK_HOUR = 9;

export const FOLLOW_UP_METRICS = ['citations', 'visibility'] as const;
export type FollowUpMetric = (typeof FOLLOW_UP_METRICS)[number];

/** What a check reads: a page, an action, prompts (with their platforms), or shipped changes. */
export interface FollowUpTarget {
  url?: string;
  action_id?: string;
  prompt_ids?: string[];
  platforms?: string[];
  /** An agent's: the changes its run shipped (ship_events), measured by the impact ledger. */
  ship_event_ids?: string[];
}

/** A check as the tool asks for it. */
export interface NewFollowUp {
  brandId: string;
  title: string;
  days: number;
  target: FollowUpTarget;
  metric: FollowUpMetric;
}

/** Who sets it, and where. */
export interface FollowUpMaker {
  userId: string;
  organizationId: string;
  timezone: string;
  /** The Chat run that set it: its chat gets the result. */
  runId: string | null;
  /** How: a person's click, or a Full auto run by itself. */
  via: 'card' | 'full_auto';
}

export interface FollowUpRefusal {
  ok: false;
  reason: 'invalid' | 'not_found' | 'forbidden_role';
  message: string;
}

export interface MadeFollowUp {
  ok: true;
  schedule_id: string;
  title: string;
  /** "Mon 9 Nov, 09:00" */
  date: string;
  due_at: string;
  automatic: boolean;
}

const refuse = (reason: FollowUpRefusal['reason'], message: string): FollowUpRefusal => ({
  ok: false,
  reason,
  message,
});

const zoneOf = (timezone: string) => (isTimeZone(timezone) ? timezone : 'UTC');

/** When a check `days` out is due: that day, 09:00 on the zone's clock. */
export function followUpDueAt(days: number, timeZone: string, now: Date): string {
  const zone = zoneOf(timeZone);
  const day = dayIn(now.getTime() + days * 86_400_000, zone);
  return zonedInstant(day, CHECK_HOUR, 0, zone);
}

/** The check's date as the card and its step say it. */
export function followUpDateWords(dueAt: string, timeZone: string, now: Date): string {
  return dateWords(dueAt, zoneOf(timeZone), now, whenT);
}

/**
 * The checks before the card, and again before the check is made: an Admin
 * or a Manager with the brand in their access, and a target of the brand
 * (its prompts, its action). Answers the refusal the model is told, or null.
 */
export async function checkNewFollowUp(
  maker: Pick<FollowUpMaker, 'userId' | 'organizationId'>,
  input: NewFollowUp,
): Promise<FollowUpRefusal | null> {
  const { target } = input;
  if (!target.url && !target.action_id && !(target.prompt_ids ?? []).length) {
    return refuse('invalid', t('tool.noTarget'));
  }
  const ctx = await readPrecedenceContext({
    userId: maker.userId,
    organizationId: maker.organizationId,
    mode: 'auto',
    surface: 'chat',
  });
  if (!ctx || (ctx.role !== 'admin' && ctx.role !== 'manager')) {
    return refuse('forbidden_role', t('tool.role'));
  }
  if (ctx.brandAccess !== 'all' && !ctx.brandAccess.includes(input.brandId)) {
    return refuse('not_found', t('tool.notFound'));
  }
  const prompts = target.prompt_ids ?? [];
  if (prompts.length) {
    const { data, error } = await supabaseAdmin
      .from('prompts')
      .select('id, prompt_set_id')
      .in('id', prompts);
    if (error) throw new Error(`Could not read a check's prompts: ${error.message}`);
    const rows = (data ?? []) as { id: string; prompt_set_id: string }[];
    const setIds = [...new Set(rows.map((row) => row.prompt_set_id))];
    const { data: sets, error: setsError } = setIds.length
      ? await supabaseAdmin
          .from('prompt_sets')
          .select('id')
          .in('id', setIds)
          .eq('brand_id', input.brandId)
      : { data: [], error: null };
    if (setsError) throw new Error(`Could not read a check's prompts: ${setsError.message}`);
    const brandSets = new Set(((sets ?? []) as { id: string }[]).map((set) => set.id));
    const ours = rows.filter((row) => brandSets.has(row.prompt_set_id));
    if (ours.length !== new Set(prompts).size) return refuse('not_found', t('tool.notFound'));
  }
  if (target.action_id) {
    const { data, error } = await supabaseAdmin
      .from('actions')
      .select('id')
      .eq('id', target.action_id)
      .eq('brand_id', input.brandId)
      .maybeSingle();
    if (error) throw new Error(`Could not read a check's action: ${error.message}`);
    if (!data) return refuse('not_found', t('tool.notFound'));
  }
  return null;
}

/** The chat a run is in: where the check's result goes. */
async function chatOfRun(runId: string | null): Promise<string | null> {
  if (!runId) return null;
  const { data, error } = await supabaseAdmin
    .from('chat_runs')
    .select('conversation_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a run's chat: ${error.message}`);
  return (data as { conversation_id: string } | null)?.conversation_id ?? null;
}

/**
 * Makes the check (above): a job of kind followup_check, due once, in the
 * chat that set it, as its maker. A refusal answers instead, nothing written.
 */
export async function createFollowUpCheck(
  maker: FollowUpMaker,
  input: NewFollowUp,
  now: Date = new Date(),
): Promise<MadeFollowUp | FollowUpRefusal> {
  const refused = await checkNewFollowUp(maker, input);
  if (refused) return refused;
  const zone = zoneOf(maker.timezone);
  const dueAt = followUpDueAt(input.days, zone, now);
  const conversationId = await chatOfRun(maker.runId);
  const target = {
    ...(input.target.url ? { url: input.target.url } : {}),
    ...(input.target.action_id ? { action_id: input.target.action_id } : {}),
    ...(input.target.prompt_ids?.length ? { prompt_ids: input.target.prompt_ids } : {}),
    ...(input.target.platforms?.length ? { platforms: input.target.platforms } : {}),
  };
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .insert({
      organization_id: maker.organizationId,
      kind: 'followup_check',
      run_mode: 'run_at',
      due_at: dueAt,
      next_run_at: dueAt,
      rrule: null,
      timezone: zone,
      title: input.title.trim().slice(0, 120),
      // What the check is, for the job's line: it never runs as a Chat message.
      prompt: t('job.prompt', { title: input.title.trim() }),
      brand_id: input.brandId,
      created_by: maker.userId,
      conversation_id: conversationId,
      deliver_to: ['chat'],
      target_json: target,
      metric: input.metric,
      created_via: maker.via,
      set_by_run_id: maker.runId,
      enabled: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not set the check: ${error?.message ?? 'no row'}`);
  return {
    ok: true,
    schedule_id: (data as { id: string }).id,
    title: input.title.trim(),
    date: followUpDateWords(dueAt, zone, now),
    due_at: dueAt,
    automatic: maker.via === 'full_auto',
  };
}

/** The check's step once set: "Set a follow-up check: {title}", its date and no extra cost. */
export function followUpStep(made: MadeFollowUp): { label: string; detail: string } {
  return {
    label: t('step.done', { title: made.title }),
    detail: t('step.detail', { date: made.date }),
  };
}

// ─── An agent's checks (CHAT-21 §I item 43) ─────────────────────────────────

/**
 * An agent run that shipped something gets its follow-up check: its
 * version's follow-up days after the first change it shipped, on the
 * changes it shipped (the impact ledger's measurements of them), in the
 * run's chat, as the person it acted as, set by the agent (full_auto).
 * Once per run. Never throws: a check that can't be set is logged.
 */
export async function openAgentFollowUps(agentRunId: string, now: Date = new Date()) {
  try {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('chat_schedules')
      .select('id')
      .eq('agent_run_id', agentRunId)
      .eq('kind', 'followup_check')
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if ((existing ?? []).length > 0) return;

    const { data: runData, error: runError } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id, organization_id, agent_id, agent_version, brand_id, acting_user_id')
      .eq('id', agentRunId)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    const run = runData as {
      id: string;
      organization_id: string;
      agent_id: string | null;
      agent_version: number;
      brand_id: string | null;
      acting_user_id: string | null;
    } | null;
    if (!run?.agent_id || !run.acting_user_id) return;

    const { data: ships, error: shipsError } = await supabaseAdmin
      .from('ship_events')
      .select('id, brand_id, title, shipped_at')
      .eq('agent_run_id', agentRunId)
      .order('shipped_at', { ascending: true })
      .limit(20);
    if (shipsError) throw new Error(shipsError.message);
    const shipped = (ships ?? []) as {
      id: string;
      brand_id: string;
      title: string;
      shipped_at: string;
    }[];
    if (shipped.length === 0) return;

    const { data: version, error: versionError } = await supabaseAdmin
      .from('chat_agent_versions')
      .select('followup_days')
      .eq('agent_id', run.agent_id)
      .eq('version', run.agent_version)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    const days = Number((version as { followup_days?: number } | null)?.followup_days) || 14;

    const { data: chat } = await supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('agent_run_id', agentRunId)
      .is('deleted_at', null)
      .limit(1);
    const conversationId = ((chat ?? []) as { id: string }[])[0]?.id ?? null;

    const first = shipped[0];
    const dueAt = new Date(Date.parse(first.shipped_at) + days * 86_400_000);
    // A check whose day already passed (a late settle) is due now.
    const due = (dueAt.getTime() > now.getTime() ? dueAt : now).toISOString();
    const title = t('job.agentTitle', { title: first.title.slice(0, 80) }).slice(0, 120);
    const { error } = await supabaseAdmin.from('chat_schedules').insert({
      organization_id: run.organization_id,
      kind: 'followup_check',
      run_mode: 'run_at',
      due_at: due,
      next_run_at: due,
      timezone: 'UTC',
      title,
      prompt: t('job.prompt', { title }),
      brand_id: run.brand_id ?? first.brand_id,
      created_by: run.acting_user_id,
      conversation_id: conversationId,
      deliver_to: ['chat'],
      target_json: { ship_event_ids: shipped.map((ship) => ship.id) },
      metric: 'visibility',
      created_via: 'full_auto',
      agent_id: run.agent_id,
      agent_run_id: run.id,
      enabled: true,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error('[chat/follow-ups] could not set an agent run’s check:', err);
  }
}
