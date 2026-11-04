import { supabaseAdmin } from '@/lib/supabase/admin';
import { nextScheduleFire } from '../agent-schedule';
import type { PrecedenceContext } from '../precedence';
import { deliverChoiceOf, type DeliverChoice } from './store';
import type { ScheduleWhen } from './when';

/**
 * What the Scheduled page reads (CHAT-12 items 21–25; W3-03; mockup
 * `#s-sched`), on the server with the service role, as the table's own
 * rule has it (00457's RLS): a person sees their own jobs, an Admin every
 * job of the workspace; a job about a brand only by people who reach it.
 * Beside them, the agents' Schedule triggers (Wave 3 decision 15: they stay
 * in chat_agent_triggers): their owner's, and every agent's for an Admin,
 * edited in Agent Center. Never an id the person can't open; never dollars.
 */

/** Who reads: the person, their role and the brands they reach (readPrecedenceContext). */
export type ScheduleReader = Pick<PrecedenceContext, 'organizationId' | 'role' | 'brandAccess'> & {
  userId: string;
};

const JOB_COLUMNS =
  'id, kind, run_mode, due_at, next_run_at, rrule, timezone, title, prompt, skill_name, brand_id, created_by, conversation_id, deliver_to, change_only, mode, enabled, paused_reason, created_via, set_by_run_id, agent_id, target_json, metric, created_at';

interface JobRow {
  id: string;
  kind: 'once' | 'recurring' | 'followup_check';
  run_mode: 'run_at' | 'ready_by';
  due_at: string | null;
  next_run_at: string | null;
  rrule: string | null;
  timezone: string;
  title: string;
  prompt: string | null;
  skill_name: string | null;
  brand_id: string | null;
  created_by: string | null;
  conversation_id: string | null;
  deliver_to: string[];
  change_only: boolean;
  mode: string;
  enabled: boolean;
  paused_reason: string | null;
  created_via: 'card' | 'full_auto';
  set_by_run_id: string | null;
  agent_id: string | null;
  created_at: string;
}

/** A run as the list and the history say it. */
export interface ScheduleRunView {
  status: string;
  startedAt: string;
  endedAt: string | null;
  /** Its words when it failed or was skipped. */
  reason: string | null;
  partsDone: number;
  partsTotal: number;
  /** Its use, a share of the monthly AI limit (0.006: 0.6%). */
  usageShare: number;
  runNow: boolean;
  emailed: boolean;
}

/** A job as the page lists it. */
export interface ScheduleListItem {
  id: string;
  kind: JobRow['kind'];
  title: string;
  skill: string | null;
  prompt: string | null;
  brand: string | null;
  /** When it runs, as the schedule's words read it; null for a follow-up check. */
  when: ScheduleWhen | null;
  timezone: string;
  nextRunAt: string | null;
  dueAt: string | null;
  enabled: boolean;
  pausedReason: string | null;
  deliver: DeliverChoice;
  changeOnly: boolean;
  mode: string;
  /** Set by a Full auto run (a follow-up check), not by a click. */
  auto: boolean;
  /** Its creator's name, when it isn't the person's. */
  createdBy: string | null;
  mine: boolean;
  lastRun: ScheduleRunView | null;
  /** The job's chat, where its results are. */
  chatHref: `/dashboard/${string}` | null;
  /** On, off and delete: its creator and Admins. */
  canManage: boolean;
  /** Run now and edits: its creator, as runs act as them. */
  canEdit: boolean;
  /** An Admin takes over a job whose creator can't run it (left, role, brand). */
  canTakeOver: boolean;
}

/** An agent's Schedule trigger, listed beside the jobs, edited in Agent Center. */
export interface AgentScheduleItem {
  agentName: string;
  config: unknown;
  enabled: boolean;
  nextRunAt: string | null;
  href: `/dashboard/${string}`;
}

const whenOf = (job: JobRow): ScheduleWhen | null => {
  if (job.kind === 'recurring' && job.rrule) return { kind: 'recurring', rrule: job.rrule };
  if (job.kind === 'once' && job.due_at) {
    return { kind: 'once', runMode: job.run_mode, dueAt: job.due_at };
  }
  return null;
};

const runOf = (row: Record<string, unknown>): ScheduleRunView => ({
  status: String(row.status),
  startedAt: String(row.started_at),
  endedAt: (row.ended_at as string | null) ?? null,
  reason: (row.reason as string | null) ?? null,
  partsDone: Number(row.parts_done) || 0,
  partsTotal: Number(row.parts_total) || 0,
  usageShare: Number(row.usage_share) || 0,
  runNow: row.run_now === true,
  emailed: row.email_status === 'sent',
});

/** Whether the reader may see a job, as 00457's policy: theirs or an Admin's, on a brand they reach. */
export function canSeeJob(
  reader: ScheduleReader,
  job: Pick<JobRow, 'created_by' | 'brand_id'>,
): boolean {
  if (reader.role !== 'admin' && job.created_by !== reader.userId) return false;
  return !job.brand_id || reader.brandAccess === 'all' || reader.brandAccess.includes(job.brand_id);
}

async function namesOf(ids: string[], table: 'brands' | 'profiles') {
  if (ids.length === 0) return new Map<string, string>();
  const column = table === 'brands' ? 'name' : 'full_name';
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(`id, ${column}`)
    .in('id', [...new Set(ids)]);
  if (error) throw new Error(`Could not read names: ${error.message}`);
  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((row) => [
      String(row.id),
      String(row[column] ?? ''),
    ]),
  );
}

/** The latest run of each job, by job. */
async function lastRuns(jobIds: string[]): Promise<Map<string, ScheduleRunView>> {
  const last = new Map<string, ScheduleRunView>();
  if (jobIds.length === 0) return last;
  const { data, error } = await supabaseAdmin
    .from('chat_schedule_runs')
    .select(
      'schedule_id, status, reason, parts_done, parts_total, usage_share, run_now, email_status, started_at, ended_at',
    )
    .in('schedule_id', jobIds)
    .order('started_at', { ascending: false })
    .limit(Math.min(1000, jobIds.length * 10));
  if (error) throw new Error(`Could not read the jobs' runs: ${error.message}`);
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = String(row.schedule_id);
    if (!last.has(id)) last.set(id, runOf(row));
  }
  return last;
}

function listItem(
  reader: ScheduleReader,
  job: JobRow,
  names: { brands: Map<string, string>; people: Map<string, string> },
  last: ScheduleRunView | null,
): ScheduleListItem {
  const mine = job.created_by === reader.userId;
  const admin = reader.role === 'admin';
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    skill: job.skill_name,
    prompt: job.prompt,
    brand: job.brand_id ? (names.brands.get(job.brand_id) ?? null) : null,
    when: whenOf(job),
    timezone: job.timezone,
    nextRunAt: job.enabled ? job.next_run_at : null,
    dueAt: job.due_at,
    enabled: job.enabled,
    pausedReason: job.paused_reason,
    deliver: deliverChoiceOf(job.deliver_to ?? ['chat']),
    changeOnly: job.change_only,
    mode: job.mode,
    auto: job.created_via === 'full_auto',
    createdBy: mine || !job.created_by ? null : (names.people.get(job.created_by) ?? null),
    mine,
    lastRun: last,
    chatHref: mine && job.conversation_id ? `/dashboard/chat/${job.conversation_id}` : null,
    canManage: mine || admin,
    canEdit: mine && job.kind !== 'followup_check',
    canTakeOver: admin && !mine && !job.enabled && job.paused_reason === 'owner_role',
  };
}

/** The Scheduled page's rows (above): jobs newest first, and the agents' Schedule triggers. */
export async function readScheduleList(
  reader: ScheduleReader,
  now: Date = new Date(),
): Promise<{ jobs: ScheduleListItem[]; agents: AgentScheduleItem[] }> {
  let query = supabaseAdmin
    .from('chat_schedules')
    .select(JOB_COLUMNS)
    .eq('organization_id', reader.organizationId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (reader.role !== 'admin') query = query.eq('created_by', reader.userId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the scheduled jobs: ${error.message}`);
  const jobs = ((data ?? []) as JobRow[]).filter((job) => canSeeJob(reader, job));
  const [brands, people, last, agents] = await Promise.all([
    namesOf(
      jobs.flatMap((j) => (j.brand_id ? [j.brand_id] : [])),
      'brands',
    ),
    namesOf(
      jobs.flatMap((j) => (j.created_by ? [j.created_by] : [])),
      'profiles',
    ),
    lastRuns(jobs.map((j) => j.id)),
    readAgentSchedules(reader, now),
  ]);
  return {
    jobs: jobs.map((job) => listItem(reader, job, { brands, people }, last.get(job.id) ?? null)),
    agents,
  };
}

/** The agents' Schedule triggers the reader may see: their own agents', every one for an Admin. */
async function readAgentSchedules(reader: ScheduleReader, now: Date): Promise<AgentScheduleItem[]> {
  let query = supabaseAdmin
    .from('chat_agents')
    .select('id, name, owner_id, status')
    .eq('organization_id', reader.organizationId)
    .is('archived_at', null);
  if (reader.role !== 'admin') query = query.eq('owner_id', reader.userId);
  const { data: agents, error } = await query;
  if (error) throw new Error(`Could not read the agents: ${error.message}`);
  const byId = new Map(
    ((agents ?? []) as { id: string; name: string; status: string }[]).map((a) => [a.id, a]),
  );
  if (byId.size === 0) return [];
  const { data: triggers, error: triggerError } = await supabaseAdmin
    .from('chat_agent_triggers')
    .select('agent_id, config_json, enabled')
    .in('agent_id', [...byId.keys()])
    .eq('kind', 'schedule');
  if (triggerError)
    throw new Error(`Could not read the agents' schedules: ${triggerError.message}`);
  return ((triggers ?? []) as { agent_id: string; config_json: unknown; enabled: boolean }[]).map(
    (trigger) => {
      const agent = byId.get(trigger.agent_id)!;
      const on = trigger.enabled && agent.status === 'active';
      return {
        agentName: agent.name,
        config: trigger.config_json,
        enabled: on,
        nextRunAt: on ? nextScheduleFire(trigger.config_json, now) : null,
        href: `/dashboard/agents/${agent.id}`,
      };
    },
  );
}

/** A job's page: the job, its last 20 runs, and its chat. Null when the reader can't see it. */
export async function readScheduleDetail(
  reader: ScheduleReader,
  id: string,
): Promise<{ job: ScheduleListItem; runs: ScheduleRunView[] } | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .select(JOB_COLUMNS)
    .eq('id', id)
    .eq('organization_id', reader.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the scheduled job: ${error.message}`);
  const job = data as JobRow | null;
  if (!job || !canSeeJob(reader, job)) return null;
  const [brands, people, runsRead] = await Promise.all([
    namesOf(job.brand_id ? [job.brand_id] : [], 'brands'),
    namesOf(job.created_by ? [job.created_by] : [], 'profiles'),
    supabaseAdmin
      .from('chat_schedule_runs')
      .select(
        'status, reason, parts_done, parts_total, usage_share, run_now, email_status, started_at, ended_at',
      )
      .eq('schedule_id', id)
      .order('started_at', { ascending: false })
      .limit(20),
  ]);
  if (runsRead.error) throw new Error(`Could not read the job's runs: ${runsRead.error.message}`);
  const runs = ((runsRead.data ?? []) as Record<string, unknown>[]).map(runOf);
  return { job: listItem(reader, job, { brands, people }, runs[0] ?? null), runs };
}
