'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { addPromptToSet } from '@/lib/actions/prompt';
import { API_BASE_URL } from '@/config/api';
// Types only — this file is `'use server'`, so the guards that go with them
// live in a plain module (every runtime export here must be a server action).
import type { PromptSuggestionSource, SuggestionSourceData } from '@/lib/prompt-suggestion-source';

const AEO_SERVER_URL = API_BASE_URL;

export interface PromptSuggestion {
  id: string;
  brandId: string;
  suggestedText: string;
  topicName: string | null;
  topicId: string | null;
  reason: string | null;
  estVolume: number | null;
  /** 0–1, how closely it fits the brand (VIS-011); null before 00138. */
  relevance: number | null;
  source: PromptSuggestionSource;
  sourceData: SuggestionSourceData | null;
  status: 'new' | 'added' | 'dismissed';
  generatedAt: string;
  expiresAt: string;
}

interface SuggestionRow {
  id: string;
  brand_id: string;
  suggested_text: string;
  topic_name: string | null;
  topic_id: string | null;
  reason: string | null;
  est_volume: number | null;
  relevance?: number | null;
  source: PromptSuggestionSource;
  source_data: SuggestionSourceData | null;
  status: 'new' | 'added' | 'dismissed';
  generated_at: string;
  expires_at: string;
}

function mapRow(row: SuggestionRow): PromptSuggestion {
  return {
    id: row.id,
    brandId: row.brand_id,
    suggestedText: row.suggested_text,
    topicName: row.topic_name,
    topicId: row.topic_id,
    reason: row.reason,
    estVolume: row.est_volume,
    relevance: row.relevance ?? null,
    source: row.source,
    sourceData: row.source_data ?? null,
    status: row.status,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
  };
}

async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}

export async function getPromptSuggestions(
  brandId: string,
): Promise<{ suggestions: PromptSuggestion[]; stale: boolean }> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${brandId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
    // Read-only cache lookup — a hung upstream must not pin the suggestions
    // card (and the serialized server-action queue behind it) indefinitely.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  const data = (await res.json()) as {
    suggestions: SuggestionRow[];
    stale: boolean;
  };
  return {
    suggestions: data.suggestions.map(mapRow),
    stale: data.stale,
  };
}

export async function refreshPromptSuggestions(brandId: string): Promise<PromptSuggestion[]> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${brandId}/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  const data = (await res.json()) as { suggestions: SuggestionRow[] };
  return data.suggestions.map(mapRow);
}

export async function dismissSuggestion(suggestionId: string): Promise<{ success: boolean }> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${suggestionId}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  return res.json();
}

export type AcceptSuggestionResult = { promptId: string } | { error: string; code?: 'plan_limit' };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Where an accepted suggestion goes: the brand's first prompt set, with the
 * platforms and models of its newest active prompt unless the caller picks.
 */
async function promptTarget(
  supabase: ServerClient,
  brandId: string,
  options?: { platforms?: string[]; models?: string[] },
): Promise<{ promptSetId: string; platforms: string[]; models: string[] } | { error: string }> {
  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (psErr || !ps) {
    return { error: 'No prompt set exists for this brand. Create one first.' };
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
    options?.platforms ??
    (Array.isArray(defaults?.platforms) && defaults!.platforms.length > 0
      ? (defaults!.platforms as string[])
      : ['chatgpt-web']);
  const models =
    options?.models ?? (Array.isArray(defaults?.models) ? (defaults!.models as string[]) : []);
  return { promptSetId: ps.id, platforms, models };
}

/** Marks the suggestion added on the server; a failure is logged, not returned. */
async function ackAccepted(accessToken: string, suggestionId: string, promptId: string) {
  const ack = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${suggestionId}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ promptId }),
  });
  if (!ack.ok) {
    console.error('[prompt-suggestions] accept ack failed:', await ack.text().catch(() => ''));
  }
}

export async function acceptSuggestion(
  suggestionId: string,
  options?: { platforms?: string[]; models?: string[] },
): Promise<AcceptSuggestionResult> {
  const session = await getSession();
  const supabase = await createClient();

  const { data: row, error: rowErr } = await supabase
    .from('prompt_suggestions')
    .select('id, brand_id, suggested_text, topic_name')
    .eq('id', suggestionId)
    .eq('status', 'new')
    .single();
  if (rowErr || !row) {
    return { error: 'Suggestion not found or already processed' };
  }

  const target = await promptTarget(supabase, row.brand_id, options);
  if ('error' in target) return target;

  const result = await addPromptToSet({
    ...target,
    text: row.suggested_text,
    category: row.topic_name ?? undefined,
  });
  if ('error' in result) {
    return { error: result.error, code: result.code };
  }

  await ackAccepted(session.access_token, suggestionId, result.prompt.id);
  revalidatePath('/dashboard/prompts');
  return { promptId: result.prompt.id };
}

export interface TrackSuggestionsResult {
  /** Tracked, in the order given. */
  trackedIds: string[];
  /** Already accepted or dismissed elsewhere: skipped, nothing to track. */
  skippedIds: string[];
  /** Why the rest weren't; `code` 'plan_limit' when the plan's prompt locations ran out. */
  error?: string;
  code?: 'plan_limit';
}

/** More than an Opportunities item can hold: a refresh makes 25 suggestions. */
const MAX_TRACK_AT_ONCE = 25;

/**
 * Track suggestions together: an Opportunities topic's "Track N" (VIS-011).
 * The suggestions and where they go are read once; then each prompt is added
 * on its own through addPromptToSet, so each passes the same plan check as a
 * single Track, and the run stops at the first one that fails: the plan's
 * prompt locations are full, or the rest can't be added either. Suggestions
 * already accepted or dismissed elsewhere are skipped, not a failure.
 */
export async function trackSuggestions(suggestionIds: string[]): Promise<TrackSuggestionsResult> {
  const ids = Array.isArray(suggestionIds)
    ? [...new Set(suggestionIds.filter((id) => typeof id === 'string'))]
    : [];
  if (ids.length === 0 || ids.length > MAX_TRACK_AT_ONCE) {
    return { trackedIds: [], skippedIds: [], error: 'Pick between 1 and 25 suggestions.' };
  }

  const session = await getSession();
  const supabase = await createClient();
  const { data: rows, error: rowsErr } = await supabase
    .from('prompt_suggestions')
    .select('id, brand_id, suggested_text, topic_name')
    .in('id', ids)
    .eq('status', 'new');
  if (rowsErr) return { trackedIds: [], skippedIds: [], error: rowsErr.message };

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
  const skippedIds = ids.filter((id) => !byId.has(id));
  const brandIds = new Set((rows ?? []).map((r) => r.brand_id as string));
  if (brandIds.size === 0) return { trackedIds: [], skippedIds };
  if (brandIds.size > 1) {
    return { trackedIds: [], skippedIds, error: 'Track suggestions of one brand at a time.' };
  }

  const target = await promptTarget(supabase, [...brandIds][0]);
  if ('error' in target) return { trackedIds: [], skippedIds, error: target.error };

  const added: { id: string; promptId: string }[] = [];
  let failure: { error: string; code?: 'plan_limit' } | undefined;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const result = await addPromptToSet({
      ...target,
      text: row.suggested_text as string,
      category: (row.topic_name as string | null) ?? undefined,
    });
    if ('error' in result) {
      failure = { error: result.error, code: result.code };
      break;
    }
    added.push({ id, promptId: result.prompt.id });
  }

  await Promise.all(added.map((a) => ackAccepted(session.access_token, a.id, a.promptId)));
  if (added.length > 0) revalidatePath('/dashboard/prompts');
  return { trackedIds: added.map((a) => a.id), skippedIds, ...failure };
}
