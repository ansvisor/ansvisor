'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { DraftMethod } from '@/lib/content/drafts';
import {
  PLAN_PERIODS,
  type PlanAnswers,
  type PlanDraft,
  type PlanOpportunity,
  type PlanPage,
  type PlanPeriod,
} from '@/lib/content/plan';

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
  days: z.union(PLAN_PERIODS.map((d) => z.literal(d)) as [z.ZodLiteral<7>, z.ZodLiteral<30>]),
});

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export async function getContentPlan(
  brandId: string,
  days: PlanPeriod,
): Promise<{
  pages: PlanPage[];
  answers: PlanAnswers;
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

  const read = pagesRes.data as unknown as { pages?: PlanPage[]; answers?: Partial<PlanAnswers> };
  const answers = {
    cur: Number(read.answers?.cur ?? 0),
    prev: Number(read.answers?.prev ?? 0),
  };
  const pages = (read.pages ?? []).map((p) => ({
    page: p.page,
    title: p.title ?? null,
    citations: { cur: Number(p.citations?.cur ?? 0), prev: Number(p.citations?.prev ?? 0) },
    platformsDown: Array.isArray(p.platformsDown) ? p.platformsDown : [],
    aiVisits: Number(p.aiVisits ?? 0),
    overlaps: Number(p.overlaps ?? 0),
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

  return { pages, answers, opportunities, drafts };
}
