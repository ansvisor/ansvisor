'use server';

import { createClient } from '@/lib/supabase/server';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import { getOrgLocationUsage } from '@/lib/prompt-locations';
import { assertWritable } from '@/lib/subscription-guard';
import {
  CHECK_PROMPTS,
  PROMPTS_CHECK_STEP,
  WORTH_TRACKING,
  demandTiers,
  engineNames,
  firstNameOf,
  type Demand,
} from '@/lib/action-center/first-day';

export interface FirstDayPrompt {
  id: string;
  text: string;
  topic: string | null;
  demand: Demand | null;
}

/** What Today shows on a brand's first day; each part empty or null when it couldn't be read. */
export interface TodayFirstDay {
  firstName: string | null;
  /** The engines the first answers come from, by name. */
  engines: string[];
  /** The newest tracked prompts first, CHECK_PROMPTS at most. */
  prompts: FirstDayPrompt[];
  /** Every tracked prompt. */
  total: number;
  /** "Looks good" was said for the brand. */
  checked: boolean;
  /** What a prompt added here tracks: the newest prompt's engines and models. */
  platforms: string[];
  models: string[];
  /** Stored suggestions from the website (catalog or heuristic), no new ones made. */
  suggestions: { id: string; text: string }[];
  /** Prompt spots left on the plan, across the workspace; null when unlimited or unread. */
  spots: { left: number; limit: number; plan: string } | null;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * A brand's first day on Action Center › Today (SIMPLE_NAV): the person's
 * first name, the engines its first answers come from, its tracked prompts
 * with their topic and demand (prompt_volumes, where there is one), whether
 * "Looks good" was said, the suggestions already stored for it and the
 * prompt spots left. Reads only what is stored: no suggestion is made for
 * the brand (no model call). As the person (RLS); throws on a failed read
 * of the prompts, and the check then stays away.
 */
export async function getTodayFirstDay(brandId: string): Promise<TodayFirstDay> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const [profile, brand, prompts, checked, suggestions] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    supabase.from('brands').select('organization_id').eq('id', brandId).maybeSingle(),
    supabase
      .from('prompts')
      .select('id, text, topic_id, platforms, models, created_at, prompt_sets!inner(brand_id)', {
        count: 'exact',
      })
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('getting_started_steps')
      .select('step')
      .eq('brand_id', brandId)
      .eq('step', PROMPTS_CHECK_STEP)
      .maybeSingle(),
    supabase
      .from('prompt_suggestions')
      .select('id, suggested_text')
      .eq('brand_id', brandId)
      .eq('status', 'new')
      .in('source', ['catalog', 'heuristic'])
      .gt('expires_at', new Date().toISOString())
      .order('est_volume', { ascending: false, nullsFirst: false })
      .limit(WORTH_TRACKING),
  ]);
  if (prompts.error) throw new Error(prompts.error.message);
  const rows = (prompts.data ?? []) as {
    id: string;
    text: string;
    topic_id: string | null;
    platforms: string[];
    models: string[];
  }[];
  const listed = rows.slice(0, CHECK_PROMPTS);
  const orgId = (brand.data?.organization_id as string | undefined) ?? null;

  const [topics, volumes, plan, usage] = await Promise.all([
    readTopics(supabase, listed),
    readVolumes(supabase, rows),
    orgId ? getOrgPlan(orgId).catch(() => null) : null,
    orgId ? getOrgLocationUsage(supabase, orgId).catch(() => null) : null,
  ]);
  const tiers = demandTiers(volumes);
  const limit = plan?.limits.maxPrompts ?? -1;

  return {
    firstName: firstNameOf(profile.data?.full_name),
    engines: engineNames(
      [...new Set(rows.flatMap((row) => row.platforms ?? []))],
      plan?.limits.allowedScrapers ?? null,
    ),
    prompts: listed.map((row) => ({
      id: row.id,
      text: row.text,
      topic: row.topic_id ? (topics.get(row.topic_id) ?? null) : null,
      demand: tiers.get(row.id) ?? null,
    })),
    total: prompts.count ?? rows.length,
    checked: Boolean(checked.data),
    platforms: rows[0]?.platforms ?? [],
    models: rows[0]?.models ?? [],
    suggestions: (suggestions.data ?? []).map((row) => ({
      id: row.id as string,
      text: row.suggested_text as string,
    })),
    spots:
      plan && usage && limit >= 0
        ? { left: Math.max(0, limit - usage.total), limit, plan: plan.name }
        : null,
  };
}

/** The topics' names, by id; empty when they can't be read. */
async function readTopics(supabase: Client, rows: { topic_id: string | null }[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.topic_id ? [row.topic_id] : [])))];
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await supabase.from('topics').select('id, name').in('id', ids);
  return new Map((data ?? []).map((topic) => [topic.id as string, topic.name as string]));
}

/** Each prompt's estimated AI demand, where a volume was read; empty when it can't be. */
async function readVolumes(supabase: Client, rows: { id: string }[]) {
  if (rows.length === 0) return new Map<string, number>();
  const { data } = await supabase
    .from('prompt_volumes')
    .select('prompt_id, est_ai_volume')
    .in(
      'prompt_id',
      rows.map((row) => row.id),
    );
  return new Map(
    (data ?? []).map((row) => [row.prompt_id as string, Number(row.est_ai_volume) || 0]),
  );
}

/**
 * "Looks good" on a brand's first day: the brand's prompts were checked,
 * kept as a Getting started record (a text step key, no migration), so the
 * check doesn't ask again for anyone on the brand.
 */
export async function markPromptsChecked(brandId: string): Promise<{ ok: boolean }> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { error } = await supabase.from('getting_started_steps').upsert(
    {
      brand_id: brandId,
      step: PROMPTS_CHECK_STEP,
      state: 'done',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,step' },
  );
  if (error) {
    console.error('[today] could not keep the prompts check:', error.message);
    return { ok: false };
  }
  return { ok: true };
}
