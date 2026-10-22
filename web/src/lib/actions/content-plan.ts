'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSuggestionSourceStates } from '@/lib/actions/integrations';
import { updateOpportunityStatus } from '@/lib/actions/content';
import { readAssignees } from '@/lib/action-center/assignees';
import { memberLabel } from '@/lib/action-center/display';
import type { DraftMethod } from '@/lib/content/drafts';
import type { CitedAddress, PlanResults } from '@/lib/content/plan-mix';
import {
  PLAN_PERIODS,
  type PlanAnswers,
  type PlanDraft,
  type PlanMark,
  type PlanOpportunity,
  type PlanPage,
  type PlanPeriod,
  type PlanTracking,
} from '@/lib/content/plan';
import { googleSourceStatus } from '@/lib/traffic-sources';

/**
 * What the Content plan (CE-014) is built from, read through the signed-in
 * member's session: the brand's pages as AI cites them (content_plan_pages,
 * 00220), its open opportunities for its own pages, the drafts still being
 * written (with who their Action Center task is assigned to), and the rows
 * marked as a priority or hidden (content_plan_marks, 00229).
 * lib/content/plan.ts ranks them.
 */

/** Open opportunities, as New content offers them. */
const OPEN_OPPORTUNITY_STATUSES = ['new', 'reviewed', 'sent', 'in_progress'];
const OPPORTUNITY_LIMIT = 200;
const DRAFT_LIMIT = 500;

const planInput = z.object({
  brandId: z.guid(),
  days: z.union([
    z.literal(PLAN_PERIODS[0]),
    z.literal(PLAN_PERIODS[1]),
    z.literal(PLAN_PERIODS[2]),
  ]),
});

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const OPPORTUNITY_COLUMNS = 'id, title, decision, opportunity_score, brief, source_data';
const OPPORTUNITY_KEY = 'opportunity:';
/**
 * The opportunity a row's key names (`opportunity:<id>`), or null for a
 * page's row. The server reads it from the key the mark is written under,
 * so a row's status change can't land on another opportunity.
 */
function opportunityIdOf(rowKey: string): string | null {
  return rowKey.startsWith(OPPORTUNITY_KEY) ? rowKey.slice(OPPORTUNITY_KEY.length) : null;
}

export async function getContentPlan(
  brandId: string,
  days: PlanPeriod,
): Promise<{
  pages: PlanPage[];
  answers: PlanAnswers;
  tracking: PlanTracking;
  opportunities: PlanOpportunity[];
  drafts: PlanDraft[];
  marks: PlanMark[];
} | null> {
  if (!planInput.safeParse({ brandId, days }).success) throw new Error('invalid');
  const supabase = await createClient();
  const [userRes, pagesRes, opportunitiesRes, draftsRes, marksRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('content_plan_pages', { p_brand_id: brandId, p_days: days }),
    supabase
      .from('content_opportunities')
      .select(OPPORTUNITY_COLUMNS)
      .eq('brand_id', brandId)
      .eq('type', 'owned')
      .in('status', OPEN_OPPORTUNITY_STATUSES)
      .order('opportunity_score', { ascending: false })
      .limit(OPPORTUNITY_LIMIT),
    supabase
      .from('content_drafts')
      .select('id, author, created_by, method, opportunity_id, source_url, action_id')
      .eq('brand_id', brandId)
      .in('status', ['draft', 'in_review', 'ready'])
      .order('updated_at', { ascending: false })
      .limit(DRAFT_LIMIT),
    supabase
      .from('content_plan_marks')
      .select('row_key, priority, hidden_at')
      .eq('brand_id', brandId),
  ]);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
  if (opportunitiesRes.error) throw new Error(opportunitiesRes.error.message);
  if (draftsRes.error) throw new Error(draftsRes.error.message);
  if (marksRes.error) throw new Error(marksRes.error.message);
  // Null: not the member's brand.
  if (!pagesRes.data) return null;
  const me = userRes.data.user?.id ?? null;

  const read = pagesRes.data as unknown as {
    pages?: PlanPage[];
    answers?: Partial<PlanAnswers>;
    prevFrom?: string;
    trackedSince?: string | null;
  };
  const answers = {
    cur: Number(read.answers?.cur ?? 0),
    prev: Number(read.answers?.prev ?? 0),
  };
  const tracking = {
    prevFrom: read.prevFrom ?? null,
    trackedSince: read.trackedSince ?? null,
  };
  const pages = (read.pages ?? []).map((p) => ({
    page: p.page,
    title: p.title ?? null,
    citations: { cur: Number(p.citations?.cur ?? 0), prev: Number(p.citations?.prev ?? 0) },
    platformsDown: Array.isArray(p.platformsDown) ? p.platformsDown : [],
    aiVisits: Number(p.aiVisits ?? 0),
  }));

  const marks = (marksRes.data ?? []).map(
    (m): PlanMark => ({ rowKey: m.row_key, priority: m.priority, hidden: m.hidden_at !== null }),
  );
  // A hidden opportunity's row was dismissed with it: read it too, to show
  // again, while it is still dismissed (not completed or reopened since).
  const openIds = new Set((opportunitiesRes.data ?? []).map((o) => o.id));
  const hiddenIds = marks
    .filter((m) => m.hidden)
    .map((m) => opportunityIdOf(m.rowKey))
    .filter((id): id is string => id !== null && z.guid().safeParse(id).success)
    .filter((id) => !openIds.has(id));
  const hiddenRes = hiddenIds.length
    ? await supabase
        .from('content_opportunities')
        .select(OPPORTUNITY_COLUMNS)
        .eq('brand_id', brandId)
        .eq('status', 'dismissed')
        .in('id', hiddenIds)
    : { data: [], error: null };
  if (hiddenRes.error) throw new Error(hiddenRes.error.message);

  const opportunities = [...(opportunitiesRes.data ?? []), ...(hiddenRes.data ?? [])].map(
    (o): PlanOpportunity => {
      const sd = (o.source_data ?? {}) as Record<string, unknown>;
      const brief = (o.brief ?? null) as { suggestedTitle?: unknown } | null;
      const target = Array.isArray(sd.targetPages)
        ? (sd.targetPages as { url?: unknown; title?: unknown }[]).find((p) => text(p?.url))
        : undefined;
      return {
        id: o.id,
        title: o.title,
        pageTitle: text(brief?.suggestedTitle) || null,
        decision: o.decision,
        score: Number(o.opportunity_score ?? 0),
        targetPage: target ? text(target.url) : null,
        targetTitle: text(target?.title) || null,
        competitorsCited: Array.isArray(sd.competitorsCited)
          ? sd.competitorsCited.map(text).filter(Boolean).slice(0, 2)
          : [],
        visibility: typeof sd.visibilityScore === 'number' ? sd.visibilityScore : null,
        prompts: Array.isArray(sd.prompts) ? sd.prompts.length : 0,
        assetType: Array.isArray(sd.assets)
          ? text((sd.assets as { type?: unknown }[])[0]?.type) || null
          : null,
      };
    },
  );

  // Who each draft's Action Center task is assigned to.
  const actionIds = [
    ...new Set((draftsRes.data ?? []).map((d) => d.action_id).filter(Boolean)),
  ] as string[];
  const actionsRes = actionIds.length
    ? await supabase.from('actions').select('id, assignee_id').in('id', actionIds)
    : { data: [], error: null };
  if (actionsRes.error) throw new Error(actionsRes.error.message);
  const assigneeOf = new Map(
    (actionsRes.data ?? []).map((a) => [a.id as string, a.assignee_id as string | null]),
  );
  const people = await readAssignees(
    supabase,
    brandId,
    [...assigneeOf.values()].filter(Boolean) as string[],
  );

  const drafts = (draftsRes.data ?? []).map((d): PlanDraft => {
    const assigneeId = d.action_id ? (assigneeOf.get(d.action_id) ?? null) : null;
    const person = assigneeId ? people.get(assigneeId) : undefined;
    return {
      id: d.id,
      author: d.author === 'agent' ? 'agent' : 'user',
      isMine: me !== null && d.created_by === me,
      method: d.method as DraftMethod,
      opportunityId: d.opportunity_id,
      sourceUrl: d.source_url,
      actionId: d.action_id ?? null,
      assignee: person
        ? {
            id: person.id,
            name: memberLabel({ fullName: person.fullName, email: person.email ?? '' }),
          }
        : null,
    };
  });

  return { pages, answers, tracking, opportunities, drafts, marks };
}

const markInput = z.object({
  brandId: z.guid(),
  rowKey: z.string().min(1).max(600),
});

/** A row key's opportunity, checked: 'invalid' for an opportunity key without a uuid. */
function checkedOpportunityId(rowKey: string): string | null {
  const id = opportunityIdOf(rowKey);
  if (id !== null && !z.guid().safeParse(id).success) throw new Error('invalid');
  return id;
}

/**
 * Mark a Plan row as a priority, or take the mark off (admins and managers;
 * content_plan_marks' policies refuse anyone else).
 */
export async function setPlanRowPriority(
  brandId: string,
  rowKey: string,
  priority: boolean,
): Promise<void> {
  if (!markInput.safeParse({ brandId, rowKey }).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not_found');
  const { error } = await supabase.from('content_plan_marks').upsert(
    {
      brand_id: brandId,
      row_key: rowKey,
      priority,
      updated_by: user.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,row_key' },
  );
  if (error) throw new Error(error.message);
}

/** How many opportunities one priority lookup covers: a page of the list. */
const MAX_PRIORITY_LOOKUPS = 200;

/**
 * Which of these opportunities' Plan rows are marked as a priority, for the
 * Opportunities list's Send to Plan: their ids. Ids that aren't ids are left
 * out; an empty list when the member can't read the brand's marks.
 */
export async function getPlanPriorities(
  brandId: string,
  opportunityIds: string[],
): Promise<string[]> {
  const keys = [...new Set(opportunityIds)]
    .filter((id) => z.guid().safeParse(id).success)
    .slice(0, MAX_PRIORITY_LOOKUPS)
    .map((id) => `${OPPORTUNITY_KEY}${id}`);
  if (!z.guid().safeParse(brandId).success || !keys.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_plan_marks')
    .select('row_key')
    .eq('brand_id', brandId)
    .eq('priority', true)
    .in('row_key', keys);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => m.row_key.slice(OPPORTUNITY_KEY.length));
}

/**
 * Hide a Plan row until someone shows it again (admins and managers). An
 * opportunity's row dismisses the opportunity too, so the Opportunities page
 * agrees, and remembers the status it had for showing it again.
 */
export async function hidePlanRow(brandId: string, rowKey: string): Promise<void> {
  if (!markInput.safeParse({ brandId, rowKey }).success) throw new Error('invalid');
  const opportunityId = checkedOpportunityId(rowKey);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not_found');
  let restoreStatus: string | null = null;
  if (opportunityId) {
    const { data, error } = await supabase
      .from('content_opportunities')
      .select('status')
      .eq('id', opportunityId)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('not_found');
    restoreStatus = OPEN_OPPORTUNITY_STATUSES.includes(data.status) ? data.status : 'new';
  }
  // The mark first: one that isn't the member's to write stops here.
  const { error } = await supabase.from('content_plan_marks').upsert(
    {
      brand_id: brandId,
      row_key: rowKey,
      hidden_at: new Date().toISOString(),
      restore_status: restoreStatus,
      updated_by: user.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,row_key' },
  );
  if (error) throw new Error(error.message);
  if (opportunityId) await updateOpportunityStatus(opportunityId, 'dismissed');
}

/**
 * Show a hidden Plan row again. An opportunity still dismissed gets back the
 * status it had; one completed or reopened elsewhere since keeps its status,
 * and only the mark goes.
 */
export async function showPlanRow(brandId: string, rowKey: string): Promise<void> {
  if (!markInput.safeParse({ brandId, rowKey }).success) throw new Error('invalid');
  const opportunityId = checkedOpportunityId(rowKey);
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not_found');
  const { data: mark, error: readError } = await supabase
    .from('content_plan_marks')
    .select('restore_status')
    .eq('brand_id', brandId)
    .eq('row_key', rowKey)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!mark) throw new Error('not_found');
  const { data, error } = await supabase
    .from('content_plan_marks')
    .update({
      hidden_at: null,
      restore_status: null,
      updated_by: user.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('brand_id', brandId)
    .eq('row_key', rowKey)
    .select('row_key')
    .maybeSingle();
  if (error) throw new Error(error.message);
  // No row changed: not the member's to write.
  if (!data) throw new Error('not_found');
  if (!opportunityId) return;
  const { data: opportunity, error: statusError } = await supabase
    .from('content_opportunities')
    .select('status')
    .eq('id', opportunityId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (statusError) throw new Error(statusError.message);
  if (opportunity?.status === 'dismissed') {
    await updateOpportunityStatus(opportunityId, mark.restore_status ?? 'new');
  }
}

/**
 * What AI cites in the brand's tracked answers, and what AI visits brought
 * in, for the Plan's page-type mix and results strip (content_plan_insights,
 * 00221). Analytics counts as connected as AI Traffic says it is: the
 * property set, the connection live and data synced (googleSourceStatus).
 * Null outside the member's organization.
 */
export async function getContentPlanInsights(
  brandId: string,
  days: PlanPeriod,
): Promise<{ citations: CitedAddress[]; totalCitations: number; results: PlanResults } | null> {
  if (!planInput.safeParse({ brandId, days }).success) throw new Error('invalid');
  const supabase = await createClient();
  const [{ data, error }, gaConnected] = await Promise.all([
    supabase.rpc('content_plan_insights', { p_brand_id: brandId, p_days: days }),
    getSuggestionSourceStates(brandId).then(
      (states) => googleSourceStatus(states.ga) === 'connected',
      // The property alone decides then, as before.
      () => null,
    ),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const read = data as unknown as {
    totalCitations?: number;
    citations?: CitedAddress[];
    results?: Partial<PlanResults>;
  };
  const r = read.results ?? {};
  return {
    totalCitations: Number(read.totalCitations ?? 0),
    citations: (read.citations ?? []).map((c) => ({
      url: c.url,
      title: c.title ?? null,
      own: Boolean(c.own),
      citations: Number(c.citations ?? 0),
    })),
    results: {
      visits: Number(r.visits ?? 0),
      keyEvents: Number(r.keyEvents ?? 0),
      transactions: Number(r.transactions ?? 0),
      revenue: Number(r.revenue ?? 0),
      analytics: Boolean(r.analytics) && gaConnected !== false,
      purchases: Boolean(r.purchases),
    },
  };
}
