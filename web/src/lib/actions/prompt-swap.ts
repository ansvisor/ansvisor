'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { PLANS, type PlanId } from '@/config/plans';
import { demandTiers } from '@/lib/action-center/first-day';
import { readPromptDemand } from '@/lib/action-center/prompt-demand';
import { setPromptActive } from '@/lib/actions/prompt';
import { getPromptVisibilitySummaries } from '@/lib/actions/tracking';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import {
  getOrgLocationUsage,
  locationLimitMessage,
  promptLocationCount,
} from '@/lib/prompt-locations';
import { rankPauseCandidates, type PauseCandidate } from '@/lib/prompt-swap';
import { isManager } from '@/lib/session-role';
import { assertWritable } from '@/lib/subscription-guard';
import type { VolumeEstimate } from '@/lib/volume-estimate';
import type { Prompt } from '@/types';

/**
 * "Waiting for a spot" made room for (Simplify PR 16;
 * 00535): what the Prompt-limit dialog shows, and its one-click swap. A
 * waiting prompt never starts by itself when a spot frees up (the owner's
 * decision, 2026-11-11): the person picks it here.
 */

/** Candidates the dialog gets, the least useful first. */
const CANDIDATES = 10;

/** Prompts one swap may pause. */
const MAX_PAUSE = 20;

/** Days of answers the mention rate counts, as the mockup says. */
const MENTION_DAYS = 30;

export interface SwapOptions {
  prompt: {
    id: string;
    text: string;
    brandId: string;
    /** Spots it needs: one per location. */
    locations: number;
    /** Waiting for a spot (00535); otherwise paused. */
    waiting: boolean;
  };
  plan: {
    id: PlanId;
    name: string;
    /** -1 for unlimited. */
    max: number;
    /** Active prompt locations across the workspace. */
    used: number;
  };
  /** This brand's first, then the person's other brands', the least useful first. */
  candidates: PauseCandidate[];
  /** Growth's prompt limit, for "See Growth: N prompts". */
  growthPrompts: number;
}

type Client = Awaited<ReturnType<typeof createClient>>;

type PromptRow = {
  id: string;
  text: string;
  regions: string[] | null;
  is_active: boolean;
  waiting_since: string | null;
  prompt_sets: { brand_id: string; brands: { organization_id: string; is_demo: boolean | null } };
};

const PROMPT_COLUMNS =
  'id, text, regions, is_active, waiting_since, prompt_sets!inner(brand_id, brands!inner(organization_id, is_demo))';

const one = <T>(value: T | T[] | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : (value ?? undefined);

function brandOf(row: PromptRow) {
  const set = one(row.prompt_sets);
  const brand = one(set?.brands);
  return {
    brandId: set?.brand_id ?? null,
    orgId: brand?.organization_id ?? null,
    demo: brand?.is_demo === true,
  };
}

/**
 * What the dialog shows for one waiting (or paused) prompt: what it needs,
 * the plan's numbers, and the tracked prompts the person could pause, from
 * every brand of the workspace they can see, since the limit is shared.
 * Demand is each brand's prompt_volumes; the mention rate is the Tracked
 * Prompts table's own read over 30 days. A brand whose demand or answers
 * can't be read still lists its prompts, unranked by what is missing.
 */
export async function getSwapOptions(promptId: string): Promise<SwapOptions | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompts')
    .select(PROMPT_COLUMNS)
    .eq('id', promptId)
    .maybeSingle();
  if (error || !data) return { error: 'Prompt not found' };
  const row = data as unknown as PromptRow;
  const { brandId, orgId } = brandOf(row);
  if (!brandId || !orgId) return { error: 'Prompt not found' };
  if (row.is_active) return { error: 'Already tracked' };

  try {
    const [plan, usage, brands] = await Promise.all([
      getOrgPlan(orgId),
      getOrgLocationUsage(supabase, orgId),
      supabase
        .from('brands')
        .select('id, name, is_demo')
        .eq('organization_id', orgId)
        .then(({ data: rows, error: brandsError }) => {
          if (brandsError) throw new Error(brandsError.message);
          return (rows ?? []).filter((brand) => !brand.is_demo);
        }),
    ]);
    const candidates =
      plan.limits.maxPrompts === -1
        ? []
        : await readCandidates(
            supabase,
            brandId,
            brands.map((brand) => ({ id: brand.id as string, name: brand.name as string })),
          );
    return {
      prompt: {
        id: row.id,
        text: row.text,
        brandId,
        locations: promptLocationCount(row.regions),
        waiting: row.waiting_since !== null,
      },
      plan: {
        id: plan.id,
        name: plan.name,
        max: plan.limits.maxPrompts,
        used: usage.total,
      },
      candidates: rankPauseCandidates(candidates).slice(0, CANDIDATES),
      growthPrompts: PLANS.growth.limits.maxPrompts,
    };
  } catch (err) {
    console.error('[prompt-swap] could not read the swap options:', err);
    return { error: "Couldn't read your prompts" };
  }
}

/** The tracked prompts of these brands, with their demand and 30-day mentions. */
async function readCandidates(
  supabase: Client,
  currentBrandId: string,
  brands: { id: string; name: string }[],
): Promise<PauseCandidate[]> {
  if (brands.length === 0) return [];
  const { data, error } = await supabase
    .from('prompts')
    .select('id, text, regions, prompt_sets!inner(brand_id)')
    .in(
      'prompt_sets.brand_id',
      brands.map((brand) => brand.id),
    )
    .eq('is_active', true)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    id: string;
    text: string;
    regions: string[] | null;
    prompt_sets: { brand_id: string } | { brand_id: string }[];
  }[];
  const byBrand = new Map<string, typeof rows>();
  for (const row of rows) {
    const id = one(row.prompt_sets)?.brand_id;
    if (!id) continue;
    byBrand.set(id, [...(byBrand.get(id) ?? []), row]);
  }

  const lists = await Promise.all(
    brands
      .filter((brand) => byBrand.has(brand.id))
      .map(async (brand) => {
        const list = byBrand.get(brand.id)!;
        const [demand, answers] = await Promise.all([
          readPromptDemand(
            supabase,
            brand.id,
            list.map((row) => row.id),
          ).catch((err): Map<string, VolumeEstimate> => {
            console.error('[prompt-swap] could not read demand:', err);
            return new Map();
          }),
          getPromptVisibilitySummaries(brand.id, { days: MENTION_DAYS }).catch((err) => {
            console.error('[prompt-swap] could not read the answers:', err);
            return {} as Awaited<ReturnType<typeof getPromptVisibilitySummaries>>;
          }),
        ]);
        const tiers = demandTiers(
          new Map([...demand].map(([id, estimate]) => [id, estimate.value])),
        );
        return list.map(
          (row): PauseCandidate => ({
            id: row.id,
            text: row.text,
            brandId: brand.id,
            brandName: brand.name,
            current: brand.id === currentBrandId,
            locations: promptLocationCount(row.regions),
            demand: tiers.get(row.id) ?? null,
            mentions: answers[row.id]?.mentionAnswers ?? 0,
            answers: answers[row.id]?.runs ?? 0,
          }),
        );
      }),
  );
  return lists.flat();
}

export type SwapResult =
  | { ok: true; prompt: Prompt; paused: number }
  | {
      ok: false;
      /** not_enough: the picks don't free enough, and nothing was changed. */
      code: 'not_enough' | 'not_found' | 'not_allowed' | 'failed';
      error: string;
      /**
       * Set when prompts were paused before it failed: whether they were
       * tracked again.
       */
      restored?: boolean;
      /** With restored false: the picks left paused, as the plan had no room for them. */
      stillPaused?: string[];
    };

/**
 * "Pause it and track this one": pauses the picked prompts, then tracks the
 * waiting (or paused) one through the metered activation (setPromptActive,
 * which also clears waiting_since; 00535), so the plan's limit is checked
 * the way every resume checks it. If tracking it fails, the picked prompts
 * are tracked again through that same metered path, so a write meanwhile
 * can't push the plan past its limit: once one no longer fits, it and the
 * rest stay paused and come back in stillPaused. A prompt in several locations needs that many spots:
 * picks that don't free enough are refused before anything changes. With
 * room already free, no pick is needed. Admins and managers only; errors
 * come back as values (#427).
 */
export async function swapPrompts(waitingId: string, pauseIds: string[]): Promise<SwapResult> {
  await assertWritable();
  const ids = [...new Set(Array.isArray(pauseIds) ? pauseIds : [])];
  if (typeof waitingId !== 'string' || ids.includes(waitingId) || ids.length > MAX_PAUSE) {
    return { ok: false, code: 'not_found', error: 'Prompt not found' };
  }
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return { ok: false, code: 'not_allowed', error: 'Only admins and managers can do this' };
  }

  const [target, picked] = await Promise.all([
    supabase.from('prompts').select(PROMPT_COLUMNS).eq('id', waitingId).maybeSingle(),
    ids.length > 0
      ? supabase.from('prompts').select(PROMPT_COLUMNS).in('id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (target.error || !target.data || picked.error) {
    return { ok: false, code: 'not_found', error: 'Prompt not found' };
  }
  const waiting = target.data as unknown as PromptRow;
  const pauses = (picked.data ?? []) as unknown as PromptRow[];
  const { orgId, demo } = brandOf(waiting);
  const sameOrg = pauses.every((row) => {
    const brand = brandOf(row);
    return brand.orgId === orgId && !brand.demo && row.is_active;
  });
  if (!orgId || demo || waiting.is_active || pauses.length !== ids.length || !sameOrg) {
    return { ok: false, code: 'not_found', error: 'Prompt not found' };
  }

  const [plan, usage] = await Promise.all([
    getOrgPlan(orgId),
    getOrgLocationUsage(supabase, orgId),
  ]);
  const freed = pauses.reduce((sum, row) => sum + promptLocationCount(row.regions), 0);
  const refused = locationLimitMessage(
    plan,
    usage.total - freed,
    promptLocationCount(waiting.regions),
  );
  if (refused) return { ok: false, code: 'not_enough', error: refused };

  let paused: string[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('prompts')
      .update({ is_active: false })
      .in('id', ids)
      .eq('is_active', true)
      .select('id');
    paused = (data ?? []).map((row) => row.id as string);
    if (error || paused.length !== ids.length) {
      return {
        ok: false,
        code: 'failed',
        error: error?.message ?? 'Some prompts could not be paused',
        ...(await trackAgain(paused)),
      };
    }
  }

  const tracked = await setPromptActive(waitingId, true).catch(
    (err: unknown): { error: string; code?: 'plan_limit' } => ({
      error: err instanceof Error ? err.message : 'Failed to track the prompt',
    }),
  );
  if ('error' in tracked) {
    return {
      ok: false,
      code: tracked.code === 'plan_limit' ? 'not_enough' : 'failed',
      error: tracked.error,
      ...(paused.length > 0 ? await trackAgain(paused) : {}),
    };
  }
  revalidatePath('/dashboard/prompts');
  return { ok: true, prompt: tracked.prompt, paused: paused.length };
}

/**
 * Tracks the paused picks again after the swap failed, one by one through
 * the metered activation (setPromptActive), so the plan's room is checked
 * again: something written meanwhile may have taken it. Once one is refused,
 * it and the rest stay paused rather than going over the limit.
 */
async function trackAgain(ids: string[]): Promise<{ restored: boolean; stillPaused?: string[] }> {
  for (let i = 0; i < ids.length; i++) {
    const result = await setPromptActive(ids[i], true).catch((err: unknown): { error: string } => ({
      error: err instanceof Error ? err.message : 'Failed to track the prompt',
    }));
    if ('error' in result) {
      console.error('[prompt-swap] could not track the picked prompts again:', result.error);
      return { restored: false, stillPaused: ids.slice(i) };
    }
  }
  return { restored: true };
}
