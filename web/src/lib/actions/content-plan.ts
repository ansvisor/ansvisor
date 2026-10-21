'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSuggestionSourceStates } from '@/lib/actions/integrations';
import type { DraftMethod } from '@/lib/content/drafts';
import type { CitedAddress, PlanResults } from '@/lib/content/plan-mix';
import {
  PLAN_PERIODS,
  type PlanAnswers,
  type PlanDraft,
  type PlanOpportunity,
  type PlanPage,
  type PlanPeriod,
  type PlanTracking,
} from '@/lib/content/plan';
import { googleSourceStatus } from '@/lib/traffic-sources';

/**
 * What the Content plan (CE-014) is built from, read through the signed-in
 * member's session: the brand's pages as AI cites them (content_plan_pages,
 * 00220), its open opportunities for its own pages, and the drafts still
 * being written. lib/content/plan.ts ranks them.
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

export async function getContentPlan(
  brandId: string,
  days: PlanPeriod,
): Promise<{
  pages: PlanPage[];
  answers: PlanAnswers;
  tracking: PlanTracking;
  opportunities: PlanOpportunity[];
  drafts: PlanDraft[];
} | null> {
  if (!planInput.safeParse({ brandId, days }).success) throw new Error('invalid');
  const supabase = await createClient();
  const [userRes, pagesRes, opportunitiesRes, draftsRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('content_plan_pages', { p_brand_id: brandId, p_days: days }),
    supabase
      .from('content_opportunities')
      .select('id, title, decision, opportunity_score, brief, source_data')
      .eq('brand_id', brandId)
      .eq('type', 'owned')
      .in('status', OPEN_OPPORTUNITY_STATUSES)
      .order('opportunity_score', { ascending: false })
      .limit(OPPORTUNITY_LIMIT),
    supabase
      .from('content_drafts')
      .select('id, author, created_by, method, opportunity_id, source_url')
      .eq('brand_id', brandId)
      .in('status', ['draft', 'in_review', 'ready'])
      .order('updated_at', { ascending: false })
      .limit(DRAFT_LIMIT),
  ]);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
  if (opportunitiesRes.error) throw new Error(opportunitiesRes.error.message);
  if (draftsRes.error) throw new Error(draftsRes.error.message);
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

  const opportunities = (opportunitiesRes.data ?? []).map((o): PlanOpportunity => {
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
    };
  });

  const drafts = (draftsRes.data ?? []).map(
    (d): PlanDraft => ({
      id: d.id,
      author: d.author === 'agent' ? 'agent' : 'user',
      isMine: me !== null && d.created_by === me,
      method: d.method as DraftMethod,
      opportunityId: d.opportunity_id,
      sourceUrl: d.source_url,
    }),
  );

  return { pages, answers, tracking, opportunities, drafts };
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
