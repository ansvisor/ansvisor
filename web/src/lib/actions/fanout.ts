'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { addPromptToSet } from '@/lib/actions/prompt';
import { API_BASE_URL } from '@/config/api';

/**
 * Query Fan-out (#333) — read + promote actions over the OBSERVED sub-queries
 * answer engines actually ran, captured in `prompt_results.search_queries`
 * (#332) as `[{ query, engine?, source_platform }]`. Read-only aggregation;
 * we never synthesize sub-queries.
 */

export interface FanoutSourcePrompt {
  id: string;
  text: string;
}

export interface FanoutSubQuery {
  /** The observed sub-query, in its canonical (trimmed) form. */
  query: string;
  /** Source-platform slugs that surfaced it (UI maps to labels). */
  engines: string[];
  /** Distinct tracked answers whose fan-out contained this sub-query. */
  timesSearched: number;
  /** The user's tracked prompts whose answers ran this sub-query. */
  sourcedPrompts: FanoutSourcePrompt[];
  /** True when this exact sub-query is already tracked as a prompt. */
  tracked: boolean;
  /** The tracked prompt's id when `tracked` (for linking), else null. */
  trackedPromptId: string | null;
}

export interface QueryFanoutData {
  subQueries: FanoutSubQuery[];
  /** Total distinct observed sub-queries in the window. */
  totalObserved: number;
}

interface RawSearchQueryItem {
  query?: unknown;
  engine?: unknown;
  source_platform?: unknown;
}

/** Longest fan-out window a caller may request (days). */
const MAX_FANOUT_DAYS = 90;

/**
 * Canonical form of a sub-query for display + grouping: trim, then collapse any
 * internal whitespace run (double spaces, tabs, newlines) to a single space, so
 * "best  laptops" and "best laptops" group as one row.
 */
function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Aggregate the brand's observed query fan-out over a rolling window.
 *
 * `timesSearched` counts DISTINCT answers (prompt_results rows) whose
 * `search_queries` contains the sub-query — an observed demand signal that
 * replaces Google Ads volume for these long-tail, natural-language queries.
 * Grouping is by the normalized, lower-cased query string (see normalizeQuery)
 * so whitespace/case variants collapse into one row.
 */
export async function getQueryFanout(
  brandId: string,
  opts?: { days?: number },
): Promise<QueryFanoutData> {
  const supabase = await createClient();
  // Clamp the window to a sane range so a crafted call can't force an
  // unbounded prompt_results scan + in-memory aggregation.
  const days = Math.min(Math.max(Math.trunc(opts?.days ?? 30) || 30, 1), MAX_FANOUT_DAYS);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // No server-side "non-empty" filter: comparing a jsonb column to '[]' through
  // PostgREST is unreliable, and rows with an empty fan-out contribute nothing
  // to the aggregation below anyway (the item loop skips them).
  const { data: rows, error } = await supabase
    .from('prompt_results')
    .select('prompt_id, platform, search_queries')
    .eq('brand_id', brandId)
    .gte('created_at', since);

  if (error) throw new Error(error.message);

  interface Acc {
    display: string;
    engines: Set<string>;
    promptIds: Set<string>;
    answerCount: number;
  }
  const byQuery = new Map<string, Acc>();

  for (const row of rows ?? []) {
    const items = Array.isArray(row.search_queries)
      ? (row.search_queries as RawSearchQueryItem[])
      : [];
    // Dedup within a single answer so one answer counts once per sub-query,
    // even if the engine listed it twice.
    const seenInRow = new Set<string>();
    for (const item of items) {
      const q = typeof item?.query === 'string' ? normalizeQuery(item.query) : '';
      if (!q) continue;
      const key = q.toLowerCase();

      let acc = byQuery.get(key);
      if (!acc) {
        acc = { display: q, engines: new Set(), promptIds: new Set(), answerCount: 0 };
        byQuery.set(key, acc);
      }

      const sp =
        typeof item?.source_platform === 'string' && item.source_platform
          ? item.source_platform
          : (row.platform as string | null);
      if (sp) acc.engines.add(sp);
      if (row.prompt_id) acc.promptIds.add(row.prompt_id as string);

      if (!seenInRow.has(key)) {
        acc.answerCount += 1;
        seenInRow.add(key);
      }
    }
  }

  if (byQuery.size === 0) return { subQueries: [], totalObserved: 0 };

  // Resolve the sourced prompts' text (the prompts whose answers produced the
  // fan-out) so the UI can link back to them.
  const allPromptIds = [...new Set([...byQuery.values()].flatMap((a) => [...a.promptIds]))];
  const promptTextById = new Map<string, string>();
  if (allPromptIds.length > 0) {
    const { data: promptRows } = await supabase
      .from('prompts')
      .select('id, text')
      .in('id', allPromptIds);
    for (const p of promptRows ?? []) {
      promptTextById.set(p.id as string, p.text as string);
    }
  }

  // Which sub-queries are already tracked as prompts for THIS brand? Compare
  // against the brand's active prompt texts so the row shows Tracked ✓ vs +.
  const { data: brandSets } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  const setIds = (brandSets ?? []).map((s) => s.id as string);
  const trackedByText = new Map<string, string>();
  if (setIds.length > 0) {
    const { data: existing } = await supabase
      .from('prompts')
      .select('id, text')
      .in('prompt_set_id', setIds)
      .eq('is_active', true);
    for (const p of existing ?? []) {
      trackedByText.set(normalizeQuery(p.text as string).toLowerCase(), p.id as string);
    }
  }

  const subQueries: FanoutSubQuery[] = [...byQuery.entries()]
    .map(([key, acc]) => {
      const trackedPromptId = trackedByText.get(key) ?? null;
      const sourcedPrompts = [...acc.promptIds]
        .map((id) => ({ id, text: promptTextById.get(id) ?? '' }))
        .filter((p) => p.text)
        .sort((a, b) => a.text.localeCompare(b.text));
      return {
        query: acc.display,
        engines: [...acc.engines].sort(),
        timesSearched: acc.answerCount,
        sourcedPrompts,
        tracked: trackedPromptId !== null,
        trackedPromptId,
      };
    })
    .sort((a, b) => b.timesSearched - a.timesSearched || a.query.localeCompare(b.query));

  return { subQueries, totalObserved: subQueries.length };
}

/**
 * Promote an observed sub-query into a tracked prompt for the brand. Mirrors
 * the Insights "accept suggestion" flow: add to the brand's earliest prompt
 * set, deriving platforms/models from its most recent active prompt.
 * `addPromptToSet` enforces the plan's `maxPrompts` limit.
 */
export async function trackFanoutQuery(
  brandId: string,
  query: string,
): Promise<{ promptId: string }> {
  const supabase = await createClient();
  const text = normalizeQuery(query);
  if (!text) throw new Error('Empty query');

  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (psErr || !ps) {
    throw new Error('No prompt set exists for this brand. Create one first.');
  }

  const { data: defaults } = await supabase
    .from('prompts')
    .select('platforms, models')
    .eq('prompt_set_id', ps.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const platforms =
    Array.isArray(defaults?.platforms) && defaults!.platforms.length > 0
      ? (defaults!.platforms as string[])
      : ['chatgpt-web'];
  const models = Array.isArray(defaults?.models) ? (defaults!.models as string[]) : [];

  const created = await addPromptToSet({ promptSetId: ps.id as string, text, platforms, models });

  revalidatePath('/dashboard/prompts');
  return { promptId: created.id };
}

/**
 * Classify the search intent of fan-out sub-queries via the server (#333).
 * Intent is brand-independent and cached server-side, so this is a cheap
 * on-demand lookup — a sub-query is classified by the LLM once and reused
 * everywhere after. Returns a map of normalized (lower-cased) query → intent.
 */
export async function classifyFanoutIntents(queries: string[]): Promise<Record<string, string>> {
  if (queries.length === 0) return {};

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE_URL}/api/prompts/fanout-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  const data = await res.json();
  return (data.intents ?? {}) as Record<string, string>;
}

/**
 * Observed query fan-out for a single prompt (#392).
 * Filters prompt_results by both brand_id and prompt_id so only sub-queries
 * from answers to THIS prompt are returned. Aggregation is identical to
 * getQueryFanout (normalise → dedupe per answer → count distinct answers).
 */
export async function getPromptFanout(
  brandId: string,
  promptId: string,
  opts?: { days?: number },
): Promise<QueryFanoutData> {
  const supabase = await createClient();
  const days = Math.min(Math.max(Math.trunc(opts?.days ?? 30) || 30, 1), MAX_FANOUT_DAYS);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: rows, error } = await supabase
    .from('prompt_results')
    .select('prompt_id, platform, search_queries')
    .eq('brand_id', brandId)
    .eq('prompt_id', promptId)
    .gte('created_at', since);

  if (error) throw new Error(error.message);

  interface Acc {
    display: string;
    engines: Set<string>;
    answerCount: number;
  }
  const byQuery = new Map<string, Acc>();

  for (const row of rows ?? []) {
    const items = Array.isArray(row.search_queries)
      ? (row.search_queries as RawSearchQueryItem[])
      : [];
    const seenInRow = new Set<string>();
    for (const item of items) {
      const q = typeof item?.query === 'string' ? normalizeQuery(item.query) : '';
      if (!q) continue;
      const key = q.toLowerCase();

      let acc = byQuery.get(key);
      if (!acc) {
        acc = { display: q, engines: new Set(), answerCount: 0 };
        byQuery.set(key, acc);
      }

      const sp =
        typeof item?.source_platform === 'string' && item.source_platform
          ? item.source_platform
          : (row.platform as string | null);
      if (sp) acc.engines.add(sp);

      if (!seenInRow.has(key)) {
        acc.answerCount += 1;
        seenInRow.add(key);
      }
    }
  }

  if (byQuery.size === 0) return { subQueries: [], totalObserved: 0 };

  const subQueries: FanoutSubQuery[] = [...byQuery.entries()]
    .map(([, acc]) => ({
      query: acc.display,
      engines: [...acc.engines].sort(),
      timesSearched: acc.answerCount,
      sourcedPrompts: [],
      tracked: false,
      trackedPromptId: null,
    }))
    .sort((a, b) => b.timesSearched - a.timesSearched || a.query.localeCompare(b.query));

  return { subQueries, totalObserved: subQueries.length };
}
