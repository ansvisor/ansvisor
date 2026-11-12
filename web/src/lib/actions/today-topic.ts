'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { hasFeature } from '@/config/plans';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import { getOrgLocationUsage } from '@/lib/prompt-locations';
import { assertWritable } from '@/lib/subscription-guard';
import { isManager } from '@/lib/session-role';
import { MANAGER_ROLES } from '@/lib/mcp/role-gate';
import { parseTopicCompetitors } from '@/lib/insights-topics';
import { TOPIC_NAME_CHARS } from '@/lib/topic-names';
import { readUserBrandState } from '@/lib/actions/user-brand-state';
import { acceptTopicSuggestion } from '@/lib/actions/topic-suggestions';
import { createTopic } from '@/lib/actions/topic';
import { addTopicPrompts } from '@/lib/actions/prompt';
import {
  TOPIC_PROMPTS,
  accountOldEnough,
  nameKey,
  pickTopicCandidate,
  type TopicCandidate,
} from '@/lib/action-center/topic-card';

/**
 * "New area to track" on Action Center › Today (SIMPLE_NAV, simplification
 * plan PR 17), as the signed-in person (RLS). The page shows it on the
 * person's Monday or once today's focus is finished; these read the
 * candidate, make its topic, and track the prompts the person ticks.
 */

/** The card: its topic, and the prompt spots left on the plan. */
export interface TodayTopic {
  candidate: TopicCandidate;
  /** Spots left across the workspace, with the plan's name; null when unlimited or unread. */
  spots: { left: number; plan: string } | null;
}

type Client = Awaited<ReturnType<typeof createClient>>;

const DAY_MS = 86_400_000;

/** A prompt's text as two are compared: case and spacing aside. */
const textKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** Rivals the card names at most. */
const COMPETITORS = 2;

/** Days of stored answers the card looks back over for rivals. */
const COMPETITOR_DAYS = 30;

/**
 * The card's topic for the brand, or null: for admins and managers only, not
 * on the demo brand, on a plan with topic suggestions, once the workspace's
 * first brand is 14 days old, and when stored data makes a strong case
 * (lib/action-center/topic-card.ts). Reads only what is stored: no model
 * call. Throws when no one is signed in or the ideas can't be read; the card
 * then stays away.
 */
export async function getTodayTopic(brandId: string): Promise<TodayTopic | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const [profile, brand] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('brands').select('organization_id, is_demo').eq('id', brandId).maybeSingle(),
  ]);
  if (!MANAGER_ROLES.some((role) => role === profile.data?.role)) return null;
  if (!brand.data || brand.data.is_demo) return null;
  const orgId = brand.data.organization_id as string;
  const now = new Date();
  const [plan, first] = await Promise.all([
    getOrgPlan(orgId),
    supabase
      .from('brands')
      .select('created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!hasFeature(plan, 'topic_suggestions')) return null;
  if (!accountOldEnough((first.data?.created_at as string | undefined) ?? null, now)) return null;

  const [topicSuggestions, ideas, topics, state] = await Promise.all([
    supabase
      .from('topic_suggestions')
      .select('id, name, source, source_data')
      .eq('brand_id', brandId)
      .eq('status', 'new')
      .limit(200),
    supabase
      .from('prompt_suggestions')
      .select('id, topic_id, topic_name, source, expires_at')
      .eq('brand_id', brandId)
      .eq('status', 'new')
      .in('source', ['gsc', 'ga', 'business_hub'])
      .limit(1000),
    supabase.from('topics').select('id, name').eq('brand_id', brandId).eq('is_active', true),
    readUserBrandState(brandId),
  ]);
  for (const read of [topicSuggestions, ideas, topics]) {
    if (read.error) throw new Error(read.error.message);
  }
  const ideaRows = (ideas.data ?? []).map((row) => ({
    id: row.id as string,
    topicId: (row.topic_id as string | null) ?? null,
    topicName: (row.topic_name as string | null) ?? null,
    source: row.source as string,
    expiresAt: (row.expires_at as string | null) ?? null,
  }));
  const suggestionRows = (topicSuggestions.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    source: row.source as string,
    sourceData: row.source_data as unknown,
  }));
  const topicRows = (topics.data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));

  // Which of the topics in question have a prompt tracked or waiting: those are covered.
  const keys = new Set([
    ...suggestionRows.map((row) => nameKey(row.name)),
    ...ideaRows.flatMap((row) => (row.topicName ? [nameKey(row.topicName)] : [])),
  ]);
  const asked = [
    ...new Set([
      ...ideaRows.flatMap((row) => (row.topicId ? [row.topicId] : [])),
      ...topicRows.filter((t) => keys.has(nameKey(t.name))).map((t) => t.id),
    ]),
  ].slice(0, 200);
  const prompts = await readTopicPrompts(supabase, brandId, asked);

  const candidate = pickTopicCandidate({
    topicSuggestions: suggestionRows,
    promptIdeas: ideaRows,
    topics: topicRows,
    coveredTopicIds: prompts.covered,
    // Unread, nothing is taken as snoozed: the card is one Not now away.
    hidden: state?.hidden ?? {},
    now,
  });
  if (!candidate) return null;

  const [competitors, usage] = await Promise.all([
    // Only a topic whose prompts were tracked once has answers to name rivals from.
    candidate.topicId && prompts.paused.has(candidate.topicId)
      ? readCompetitors(supabase, brandId, candidate.topicId, now).catch(() => [])
      : Promise.resolve([]),
    getOrgLocationUsage(supabase, orgId).catch(() => null),
  ]);
  const limit = plan.limits.maxPrompts;
  return {
    candidate: { ...candidate, competitors },
    spots: usage && limit >= 0 ? { left: Math.max(0, limit - usage.total), plan: plan.name } : null,
  };
}

/**
 * Of these topics, those with a prompt tracked or waiting for a spot
 * (covered), and those whose prompts are all paused (tracked once).
 */
async function readTopicPrompts(
  supabase: Client,
  brandId: string,
  topicIds: string[],
): Promise<{ covered: Set<string>; paused: Set<string> }> {
  const covered = new Set<string>();
  const paused = new Set<string>();
  if (topicIds.length === 0) return { covered, paused };
  const { data, error } = await supabase
    .from('prompts')
    .select('topic_id, is_active, waiting_since, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .in('topic_id', topicIds)
    .limit(1000);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const id = row.topic_id as string;
    if (row.is_active || row.waiting_since) covered.add(id);
    else paused.add(id);
  }
  for (const id of covered) paused.delete(id);
  return { covered, paused };
}

/**
 * Rivals AI answers named in the topic over the last 30 days, most named
 * first: the topic heat map's stored rollups (insights_topic_competitors_daily),
 * as Opportunities reads who leads a topic. Empty when none are stored.
 */
async function readCompetitors(
  supabase: Client,
  brandId: string,
  topicId: string,
  now: Date,
): Promise<string[]> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('insights_topic_competitors_daily', {
    p_brand_id: brandId,
    p_day_from: day(now.getTime() - COMPETITOR_DAYS * DAY_MS),
    p_day_to: day(now.getTime()),
  });
  if (error) return [];
  const topic = parseTopicCompetitors(data)?.find((t) => t.topicId === topicId);
  const ids = Object.entries(topic?.competitors ?? {})
    .filter(([, c]) => c.mentionAnswers > 0)
    .sort((a, b) => b[1].mentionAnswers - a[1].mentionAnswers)
    .slice(0, COMPETITORS)
    .map(([id]) => id);
  if (ids.length === 0) return [];
  const { data: rows } = await supabase
    .from('competitors')
    .select('id, name')
    .eq('brand_id', brandId)
    .in('id', ids);
  const names = new Map((rows ?? []).map((row) => [row.id as string, row.name as string]));
  return ids.flatMap((id) => (names.has(id) ? [names.get(id)!] : []));
}

/** What the card picked: its name, its topic idea (catalog or the model's), and its topic. */
export interface TopicPick {
  name: string;
  suggestionId?: string | null;
  topicId?: string | null;
}

export type OpenTopicResult =
  | {
      ok: true;
      topic: { id: string; name: string };
      /** The topic's stored prompt ideas, the most demand first; empty when it has none. */
      ideas: { id: string; text: string }[];
    }
  | { ok: false; error: 'forbidden' | 'failed' };

/**
 * "Suggest 5 prompts", step one: the topic, made now unless the brand has an
 * active one of that name (one with no prompt yet, say). From a topic idea
 * (a catalog category, or the model's), through acceptTopicSuggestion, so
 * the idea is marked added; else a plain topic. Then the topic's stored
 * prompt ideas, at most 5. Admins and managers; errors come back as values.
 */
export async function openTopicCard(brandId: string, pick: TopicPick): Promise<OpenTopicResult> {
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    if (!(await isManager(supabase))) return { ok: false, error: 'forbidden' };
    const topic = await topicFor(supabase, brandId, pick);
    return { ok: true, topic, ideas: await storedIdeas(supabase, brandId, topic) };
  } catch (err) {
    console.error('[today] could not open the topic card:', err);
    return { ok: false, error: 'failed' };
  }
}

async function topicFor(
  supabase: Client,
  brandId: string,
  pick: TopicPick,
): Promise<{ id: string; name: string }> {
  const name = String(pick.name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TOPIC_NAME_CHARS)
    .trim();
  if (!name) throw new Error('No topic name');
  const { data: topics, error } = await supabase
    .from('topics')
    .select('id, name')
    .eq('brand_id', brandId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  const existing = (topics ?? []).find(
    (t) => t.id === pick.topicId || nameKey(t.name as string) === nameKey(name),
  );
  if (existing) return { id: existing.id as string, name: existing.name as string };

  if (pick.suggestionId) {
    const { data: idea } = await supabase
      .from('topic_suggestions')
      .select('id, brand_id')
      .eq('id', pick.suggestionId)
      .eq('status', 'new')
      .maybeSingle();
    if (idea?.brand_id === brandId) {
      const { topicId } = await acceptTopicSuggestion(pick.suggestionId);
      const { data: made } = await supabase
        .from('topics')
        .select('id, name')
        .eq('id', topicId)
        .maybeSingle();
      return { id: topicId, name: (made?.name as string | undefined) ?? name };
    }
  }
  const made = await createTopic(brandId, name);
  revalidatePath('/dashboard/prompts/topics');
  return { id: made.id, name: made.name };
}

/** The topic's open prompt ideas, by its id or its name, the most demand first. */
async function storedIdeas(
  supabase: Client,
  brandId: string,
  topic: { id: string; name: string },
): Promise<{ id: string; text: string }[]> {
  const { data, error } = await supabase
    .from('prompt_suggestions')
    .select('id, suggested_text, topic_id, topic_name, source, est_volume, expires_at')
    .eq('brand_id', brandId)
    .eq('status', 'new')
    .limit(1000);
  if (error) throw new Error(error.message);
  const key = nameKey(topic.name);
  const now = Date.now();
  return (data ?? [])
    .filter(
      (row) =>
        (row.topic_id === topic.id ||
          (typeof row.topic_name === 'string' && nameKey(row.topic_name) === key)) &&
        // A Business Hub idea past its 30 days is no longer listed.
        !(
          row.source === 'business_hub' &&
          row.expires_at &&
          Date.parse(row.expires_at as string) <= now
        ),
    )
    .sort((a, b) => Number(b.est_volume ?? -1) - Number(a.est_volume ?? -1))
    .slice(0, TOPIC_PROMPTS)
    .map((row) => ({ id: row.id as string, text: row.suggested_text as string }));
}

export type WriteTopicPromptsResult =
  | { ok: true; prompts: string[] }
  | { ok: false; error: 'forbidden' | 'failed' };

/**
 * "Suggest 5 prompts", when the topic has no stored ideas: the existing
 * per-topic generator (the onboarding one, POST /api/prompts/from-topics)
 * writes 5, once, on the person's click. This is the card's only model
 * call. Prompts the brand has already are left out. Admins and managers.
 */
export async function writeTopicPrompts(
  brandId: string,
  topicId: string,
): Promise<WriteTopicPromptsResult> {
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    if (!(await isManager(supabase))) return { ok: false, error: 'forbidden' };
    const [topic, brand, tracked, session] = await Promise.all([
      supabase
        .from('topics')
        .select('name')
        .eq('id', topicId)
        .eq('brand_id', brandId)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('brands')
        .select('name, industry, description, language')
        .eq('id', brandId)
        .maybeSingle(),
      supabase
        .from('prompts')
        .select('text, prompt_sets!inner(brand_id)')
        .eq('prompt_sets.brand_id', brandId)
        .limit(1000),
      supabase.auth.getSession(),
    ]);
    const token = session.data.session?.access_token;
    if (!topic.data || !brand.data || !token) return { ok: false, error: 'failed' };
    const res = await fetch(`${API_BASE_URL}/api/prompts/from-topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        brandName: String(brand.data.name).slice(0, 200),
        industry: ((brand.data.industry as string | null) ?? '').slice(0, 200),
        description: ((brand.data.description as string | null) ?? '').slice(0, 2000),
        topics: [String(topic.data.name).slice(0, TOPIC_NAME_CHARS)],
        language: (brand.data.language as string | null) ?? 'en',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, error: res.status === 403 ? 'forbidden' : 'failed' };
    const body = (await res.json()) as { topicPrompts?: { prompts?: unknown[] }[] };
    const have = new Set((tracked.data ?? []).map((row) => textKey(row.text as string)));
    const prompts = (body.topicPrompts?.[0]?.prompts ?? [])
      .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter((text) => !have.has(textKey(text)))
      .slice(0, TOPIC_PROMPTS);
    return { ok: true, prompts };
  } catch (err) {
    console.error('[today] could not write prompts for the topic:', err);
    return { ok: false, error: 'failed' };
  }
}

export type TrackTopicPromptsResult =
  | { ok: true; added: number; waiting: number }
  | { ok: false; error: string };

/**
 * "Suggest 5 prompts", last step: the prompts the person ticked go under the
 * topic through Chat's add_prompts path (addTopicPrompts, PR 15): tracked
 * while the plan has spots, and waiting for a spot past them. A ticked
 * stored idea is marked added with its prompt, as Prompt Suggestions' Track
 * marks it. Admins and managers; errors come back as values.
 */
export async function trackTopicPrompts(
  brandId: string,
  topicId: string,
  picks: { ideaId?: string | null; text: string }[],
): Promise<TrackTopicPromptsResult> {
  await assertWritable({ brandId });
  const list = (Array.isArray(picks) ? picks : [])
    .filter((pick) => typeof pick?.text === 'string' && pick.text.trim())
    .slice(0, TOPIC_PROMPTS * 2);
  if (list.length === 0) return { ok: false, error: 'Pick at least one prompt.' };
  const result = await addTopicPrompts(
    brandId,
    topicId,
    list.map((pick) => pick.text),
  );
  if (!result.ok) return { ok: false, error: result.message };

  const saved = new Map(
    [...result.added, ...(result.waiting ?? [])].map((p) => [textKey(p.text), p.id]),
  );
  const ideas = list.flatMap((pick) => {
    const promptId = pick.ideaId ? saved.get(textKey(pick.text)) : undefined;
    return promptId ? [{ id: pick.ideaId!, promptId }] : [];
  });
  if (ideas.length > 0) await markIdeasAdded(ideas);
  revalidatePath('/dashboard/prompts');
  return { ok: true, added: result.added.length, waiting: result.waiting?.length ?? 0 };
}

/** Marks stored ideas added with their prompts, on the API; a failure is logged, not returned. */
async function markIdeasAdded(ideas: { id: string; promptId: string }[]): Promise<void> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;
  await Promise.all(
    ideas.map(async ({ id, promptId }) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/prompts/suggestions/${encodeURIComponent(id)}/accept`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ promptId }),
          },
        );
        if (!res.ok) console.error('[today] a prompt idea was not marked added:', res.status);
      } catch (err) {
        console.error('[today] a prompt idea was not marked added:', err);
      }
    }),
  );
}
