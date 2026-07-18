'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { addPromptToSet } from '@/lib/actions/prompt';
import { API_BASE_URL } from '@/config/api';

const AEO_SERVER_URL = API_BASE_URL;

export interface PromptSuggestion {
  id: string;
  brandId: string;
  suggestedText: string;
  topicName: string | null;
  topicId: string | null;
  reason: string | null;
  estVolume: number | null;
  source: 'llm' | 'heuristic';
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
  source: 'llm' | 'heuristic';
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
    source: row.source,
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

export async function acceptSuggestion(
  suggestionId: string,
  options?: { platforms?: string[]; models?: string[] },
): Promise<{ promptId: string }> {
  const session = await getSession();
  const supabase = await createClient();

  const { data: row, error: rowErr } = await supabase
    .from('prompt_suggestions')
    .select('id, brand_id, suggested_text, topic_name')
    .eq('id', suggestionId)
    .eq('status', 'new')
    .single();
  if (rowErr || !row) {
    throw new Error('Suggestion not found or already processed');
  }

  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', row.brand_id)
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
    options?.platforms ??
    (Array.isArray(defaults?.platforms) && defaults!.platforms.length > 0
      ? (defaults!.platforms as string[])
      : ['chatgpt-web']);
  const models =
    options?.models ?? (Array.isArray(defaults?.models) ? (defaults!.models as string[]) : []);

  const created = await addPromptToSet({
    promptSetId: ps.id,
    text: row.suggested_text,
    category: row.topic_name ?? undefined,
    platforms,
    models,
  });

  const ack = await fetch(`${AEO_SERVER_URL}/api/prompts/suggestions/${suggestionId}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ promptId: created.id }),
  });
  if (!ack.ok) {
    console.error('[prompt-suggestions] accept ack failed:', await ack.text().catch(() => ''));
  }

  revalidatePath('/dashboard/prompts');
  return { promptId: created.id };
}
