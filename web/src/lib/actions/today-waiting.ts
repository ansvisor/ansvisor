'use server';

import { createClient } from '@/lib/supabase/server';
import { taskProgress } from '@/lib/action-center/registry';
import { readEntityCounts } from '@/lib/action-center/entity-counts';
import { ACTION_COLUMNS, actionItemFromRow, type ActionRow } from '@/lib/action-center/rows';
import { firstOpenTask, todayStep, type TodayTaskRow } from '@/lib/action-center/today';
import { REMINDER_KINDS } from '@/lib/action-center/focus';
import type { WaitingAction, WaitingPrompts } from '@/lib/action-center/waiting';
import { getTaskReviewCount } from '@/lib/actions/action-task-reviews';
import { readUserBrandState } from '@/lib/actions/user-brand-state';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import { getOrgLocationUsage, promptLocationCount } from '@/lib/prompt-locations';
import { dayIn, effectiveTimeZone } from '@/lib/time-zone';

/** What "Waiting for you" reads on the server; each part null when it couldn't be read. */
export interface TodayWaiting {
  canManage: boolean;
  /** The person's day, YYYY-MM-DD, on their clock. */
  today: string;
  drafts: { id: string; title: string }[] | null;
  actions: WaitingAction[] | null;
  /** Admins and managers only; null for anyone else. */
  reviews: number | null;
  /** New Search Console and Analytics prompt ideas since the person last opened Suggestions. */
  ideas: { count: number; sources: ('gsc' | 'ga')[] } | null;
  /** The brand's prompts waiting for a spot and the plan's room (admins and managers). */
  prompts: WaitingPrompts | null;
}

const settled = <T>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

/**
 * "Waiting for you" on Action Center › Today (SIMPLE_NAV), as the signed-in
 * person (RLS): the brand's drafts in review, its open actions due today or
 * before that are theirs or no one's, its open reminders (read by kind, so
 * the weekly Business Hub reminder shows once it exists), and for admins
 * and managers the tasks in Needs review, the prompts waiting for a spot
 * and the new prompt ideas from Search Console or Analytics. Nothing is
 * stored. The rows are ordered and
 * filtered for the person's menu by lib/action-center/waiting.ts; agent
 * runs are read in the browser, as Chat's menu reads them. Throws only when
 * no one is signed in.
 */
export async function getTodayWaiting(
  brandId: string,
  browserZone: string | null,
): Promise<TodayWaiting> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const profile = await supabase
    .from('profiles')
    .select('role, time_zone')
    .eq('id', user.id)
    .maybeSingle();
  const canManage = profile.data?.role === 'admin' || profile.data?.role === 'manager';
  const today = dayIn(Date.now(), effectiveTimeZone(profile.data?.time_zone ?? null, browserZone));

  const [drafts, actions, reviews, ideas, prompts] = await Promise.allSettled([
    supabase
      .from('content_drafts')
      .select('id, title')
      .eq('brand_id', brandId)
      .eq('status', 'in_review')
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; title: string }[];
      }),
    readWaitingActions(supabase, brandId, user.id, today),
    canManage ? getTaskReviewCount(brandId) : Promise.resolve(null),
    canManage ? readIdeas(supabase, brandId) : Promise.resolve(null),
    canManage ? readWaitingPrompts(supabase, brandId) : Promise.resolve(null),
  ]);
  return {
    canManage,
    today,
    drafts: settled(drafts),
    actions: settled(actions),
    reviews: settled(reviews),
    ideas: settled(ideas),
    prompts: settled(prompts),
  };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** Open actions due by `today`, and open reminders, that are the person's or no one's. */
async function readWaitingActions(
  supabase: Client,
  brandId: string,
  userId: string,
  today: string,
): Promise<WaitingAction[]> {
  const { data, error } = await supabase
    .from('actions')
    .select(ACTION_COLUMNS)
    .eq('brand_id', brandId)
    .in('status', ['new', 'in_progress'])
    .is('deleted_at', null)
    .or(`assignee_id.is.null,assignee_id.eq.${userId}`)
    .or(`due_date.lte.${today},kind.in.(${REMINDER_KINDS.join(',')})`)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ActionRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [tasks, entityCounts] = await Promise.all([
    supabase
      .from('action_tasks')
      .select('action_id, position, task_key, title, title_params, status, mode')
      .in('action_id', ids),
    readEntityCounts(supabase, ids),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  const tasksOf = new Map<string, TodayTaskRow[]>();
  for (const row of tasks.data ?? []) {
    const list = tasksOf.get(row.action_id) ?? [];
    list.push({
      action_id: row.action_id,
      position: row.position,
      task_key: row.task_key,
      title: row.title,
      title_params: (row.title_params ?? null) as Record<string, string | number> | null,
      status: row.status,
      mode: row.mode,
      url: null,
    });
    tasksOf.set(row.action_id, list);
  }
  return rows.map((row) => {
    const list = tasksOf.get(row.id) ?? [];
    const progress = taskProgress(list.map((task) => task.status));
    return {
      id: row.id,
      action: actionItemFromRow(row, {
        assignee: null,
        taskTotal: progress.total,
        taskCompleted: progress.completed,
        signalCount: 0,
        entityCounts: entityCounts.get(row.id),
      }),
      firstStep: todayStep(firstOpenTask(list)),
      dueDate: row.due_date,
    };
  });
}

/** New prompt ideas from Search Console or Analytics since the person last opened Suggestions. */
async function readIdeas(
  supabase: Client,
  brandId: string,
): Promise<{ count: number; sources: ('gsc' | 'ga')[] }> {
  const state = await readUserBrandState(brandId);
  const seen = state?.navSeen['prompts/suggestions'] ?? null;
  let query = supabase
    .from('prompt_suggestions')
    .select('source')
    .eq('brand_id', brandId)
    .eq('status', 'new')
    .in('source', ['gsc', 'ga'])
    .limit(500);
  if (seen) query = query.gt('generated_at', seen);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const sources = [...new Set((data ?? []).map((row) => row.source as 'gsc' | 'ga'))].sort();
  return { count: data?.length ?? 0, sources };
}

/**
 * The brand's prompts waiting for a spot (00535, idx_prompts_waiting) and
 * the room on the workspace's plan, counted across its brands as every add
 * path counts it (getOrgLocationUsage). The plan is read only when some wait.
 */
async function readWaitingPrompts(supabase: Client, brandId: string): Promise<WaitingPrompts> {
  const { data, error } = await supabase
    .from('prompts')
    .select('regions, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .not('waiting_since', 'is', null)
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return { count: 0, free: null, fits: false, plan: '' };
  const brand = await supabase
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (brand.error || !brand.data) throw new Error(brand.error?.message ?? 'Brand not found');
  const orgId = brand.data.organization_id as string;
  const [plan, usage] = await Promise.all([
    getOrgPlan(orgId),
    getOrgLocationUsage(supabase, orgId),
  ]);
  const max = plan.limits.maxPrompts;
  const free = max === -1 ? null : Math.max(0, max - usage.total);
  const smallest = Math.min(...rows.map((row) => promptLocationCount(row.regions as string[])));
  return { count: rows.length, free, fits: free === null || free >= smallest, plan: plan.id };
}
