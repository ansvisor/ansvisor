'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createTopic } from '@/lib/actions/topic';
import { API_BASE_URL } from '@/config/api';

const AEO_SERVER_URL = API_BASE_URL;

export interface TopicSuggestion {
  id: string;
  brandId: string;
  name: string;
  reason: string | null;
  source: 'llm';
  status: 'new' | 'added' | 'dismissed';
  generatedAt: string;
}

interface SuggestionRow {
  id: string;
  brand_id: string;
  name: string;
  reason: string | null;
  source: 'llm';
  status: 'new' | 'added' | 'dismissed';
  generated_at: string;
}

function mapRow(row: SuggestionRow): TopicSuggestion {
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    reason: row.reason,
    source: row.source,
    status: row.status,
    generatedAt: row.generated_at,
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

export async function getTopicSuggestions(brandId: string): Promise<TopicSuggestion[]> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${brandId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
    // Read-only lookup — a hung upstream must not pin the suggestions card
    // (and the serialized server-action queue behind it) indefinitely.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  const data = (await res.json()) as { suggestions: SuggestionRow[] };
  return data.suggestions.map(mapRow);
}

export async function refreshTopicSuggestions(brandId: string): Promise<TopicSuggestion[]> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${brandId}/refresh`, {
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

export async function dismissTopicSuggestion(suggestionId: string): Promise<{ success: boolean }> {
  const session = await getSession();
  const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${suggestionId}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  return res.json();
}

/**
 * Accept a suggestion: create exactly ONE topic via the singular createTopic
 * action (never the plural createTopics, which replaces the brand's whole
 * topic list), then ack the server so the suggestion moves to `added`.
 */
export async function acceptTopicSuggestion(suggestionId: string): Promise<{ topicId: string }> {
  const session = await getSession();
  const supabase = await createClient();

  const { data: row, error: rowErr } = await supabase
    .from('topic_suggestions')
    .select('id, brand_id, name')
    .eq('id', suggestionId)
    .eq('status', 'new')
    .single();
  if (rowErr || !row) {
    throw new Error('Suggestion not found or already processed');
  }

  const topic = await createTopic(row.brand_id, row.name);

  const ack = await fetch(`${AEO_SERVER_URL}/api/topics/suggestions/${suggestionId}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ topicId: topic.id }),
  });
  if (!ack.ok) {
    console.error('[topic-suggestions] accept ack failed:', await ack.text().catch(() => ''));
  }

  revalidatePath('/dashboard/topics');
  return { topicId: topic.id };
}
