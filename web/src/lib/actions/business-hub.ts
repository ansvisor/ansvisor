'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { businessHubEnabled } from '@/lib/business-hub/flag';
import {
  chatgptVisits,
  entryWindow,
  previousOf,
  type BusinessHubEntry,
  type EntryInput,
  type OursNumbers,
  type PeriodDays,
} from '@/lib/business-hub/numbers';
import { computeAiVisibilityScore } from '@/lib/visibility-score';

/**
 * ChatGPT Business Hub numbers on Visibility's Overview (behind
 * BUSINESS_HUB_ENABLED, read here on the server each time): the entries a
 * brand's members copied from Business Hub, and Ansvisor's own ChatGPT
 * numbers for the same days. Entries are read under the person's RLS;
 * saving and deleting go through the API, which checks the entry and the
 * role (every member enters, admins and managers delete).
 */

const id = z.guid();
/** ChatGPT, as tracking stores it. */
const CHATGPT = 'chatgpt-web';
/** ChatGPT is tracked: an answer in this many days. */
const TRACKED_DAYS = 30;
const DAY_MS = 86_400_000;

export interface BusinessHubCard {
  /** Whether the card shows: the flag, ChatGPT tracked, and an entry, the Claim task done or `asked`. */
  show: boolean;
  /** Newest last day first. */
  entries: BusinessHubEntry[];
  latest: BusinessHubEntry | null;
  /** The entry before the latest, of the same length. */
  previous: BusinessHubEntry | null;
  ours: OursNumbers | null;
  oursPrevious: OursNumbers | null;
  /** The brand's tracked topics' names, for the topic chips. */
  trackedTopics: string[];
}

const HIDDEN: BusinessHubCard = {
  show: false,
  entries: [],
  latest: null,
  previous: null,
  ours: null,
  oursPrevious: null,
  trackedTopics: [],
};

type Client = Awaited<ReturnType<typeof createClient>>;

interface SnapshotRow {
  id: string;
  period_days: number;
  period_end: string;
  mentions: number | null;
  website_clicks: number | null;
  profile_views: number | null;
  discovery_topics: string[] | null;
  source: string;
  updated_at: string | null;
}

function entryOf(row: SnapshotRow): BusinessHubEntry {
  return {
    id: row.id,
    periodDays: row.period_days === 28 ? 28 : 7,
    periodEnd: row.period_end,
    mentions: row.mentions,
    websiteClicks: row.website_clicks,
    profileViews: row.profile_views,
    topics: Array.isArray(row.discovery_topics) ? row.discovery_topics : [],
    source: row.source === 'csv' ? 'csv' : 'manual',
    updatedAt: row.updated_at,
  };
}

/** Whether ChatGPT is tracked: one of its answers in the last TRACKED_DAYS. */
async function chatgptTracked(supabase: Client, brandId: string, now: Date): Promise<boolean> {
  const { count, error } = await supabase
    .from('prompt_results')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('platform', CHATGPT)
    .gte('created_at', new Date(now.getTime() - TRACKED_DAYS * DAY_MS).toISOString());
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** Whether the setup action's Claim task is done (action-center/from-business-hub.js). */
async function claimDone(supabase: Client, brandId: string): Promise<boolean> {
  const { data: actions, error } = await supabase
    .from('actions')
    .select('id')
    .eq('brand_id', brandId)
    .eq('dedup_key', `business_hub_setup:${brandId}`)
    .limit(5);
  if (error) throw new Error(error.message);
  const ids = (actions ?? []).map((a) => a.id);
  if (!ids.length) return false;
  const { count, error: taskErr } = await supabase
    .from('action_tasks')
    .select('id', { count: 'exact', head: true })
    .in('action_id', ids)
    .eq('status', 'completed')
    .eq('details->>step', 'claim');
  if (taskErr) throw new Error(taskErr.message);
  return (count ?? 0) > 0;
}

/**
 * Ansvisor's ChatGPT numbers over an entry's days: its tracked answers'
 * AI Visibility Score and counts (ai_visibility_aggregates on chatgpt-web,
 * as the Visibility page scores them), and the visits ChatGPT's hosts sent
 * (ai_traffic_merged: the snippet and Analytics). A visits read that fails
 * leaves visits empty, not the card.
 */
async function oursFor(
  supabase: Client,
  brandId: string,
  entry: Pick<BusinessHubEntry, 'periodDays' | 'periodEnd'>,
): Promise<OursNumbers> {
  const { from, to } = entryWindow(entry);
  const [aiVis, traffic] = await Promise.all([
    supabase.rpc('ai_visibility_aggregates', {
      p_brand_id: brandId,
      p_platform: CHATGPT,
      p_date_from: from,
      p_date_to: to,
    }),
    supabase.rpc('ai_traffic_merged', {
      p_brand_id: brandId,
      p_from: from,
      p_to: to,
      p_to_inclusive: true,
      p_analytics: true,
    }),
  ]);
  if (aiVis.error) throw new Error(aiVis.error.message);
  const raw = (aiVis.data ?? {}) as {
    answers?: number;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | string | null;
  };
  const answers = Number(raw.answers ?? 0);
  const named = Number(raw.mention_answers ?? 0);
  const cited = Number(raw.citation_answers ?? 0);
  const positionFactor =
    raw.position_factor === null || raw.position_factor === undefined
      ? null
      : Number(raw.position_factor);
  const platforms = traffic.error
    ? null
    : ((traffic.data ?? {}) as { platforms?: { platform: string; visits: number }[] }).platforms;
  return {
    visibility: computeAiVisibilityScore({
      answers,
      mentionAnswers: named,
      citationAnswers: cited,
      positionFactor,
    }),
    answers,
    named,
    cited,
    visits: platforms ? chatgptVisits(platforms) : traffic.error ? null : 0,
  };
}

/**
 * Visibility's Business Hub card: whether it shows, the entries, the latest
 * and the one before of the same length, and Ansvisor's numbers for each's
 * days. `asked`: the page was opened to enter numbers (?businessHub=enter,
 * the setup action's link), which shows the card before any entry. Throws
 * when a read fails: the card hides itself, and the page is untouched.
 */
export async function getBusinessHubCard(
  brandId: string,
  { asked = false }: { asked?: boolean } = {},
): Promise<BusinessHubCard> {
  if (!businessHubEnabled() || !id.safeParse(brandId).success) return HIDDEN;
  const supabase = await createClient();
  const now = new Date();
  if (!(await chatgptTracked(supabase, brandId, now))) return HIDDEN;

  const { data, error } = await supabase
    .from('business_hub_snapshots')
    .select(
      'id, period_days, period_end, mentions, website_clicks, profile_views, discovery_topics, source, updated_at',
    )
    .eq('brand_id', brandId)
    .order('period_end', { ascending: false })
    .order('period_days', { ascending: true })
    .limit(104);
  if (error) throw new Error(error.message);
  const entries = ((data ?? []) as SnapshotRow[]).map(entryOf);
  if (!entries.length && !asked && !(await claimDone(supabase, brandId))) return HIDDEN;

  const latest = entries[0] ?? null;
  const previous = previousOf(entries, latest);
  const [ours, oursPrevious, topics] = await Promise.all([
    latest ? oursFor(supabase, brandId, latest) : null,
    previous ? oursFor(supabase, brandId, previous) : null,
    supabase.from('topics').select('name').eq('brand_id', brandId).eq('is_active', true),
  ]);
  return {
    show: true,
    entries,
    latest,
    previous,
    ours,
    oursPrevious,
    trackedTopics: topics.error ? [] : (topics.data ?? []).map((t) => t.name as string),
  };
}

// ─── Writes, through the API ────────────────────────────────────────────────

export type BusinessHubWriteError = {
  error: 'invalid' | 'failed' | 'off' | 'forbidden' | 'demo';
  field?: string;
  reason?: string;
  row?: number;
};

async function call(path: string, init: RequestInit): Promise<Response | BusinessHubWriteError> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/business-hub${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      field?: string;
      reason?: string;
      row?: number;
    };
    if (res.status === 404 && body.code === 'off') return { error: 'off' };
    if (res.status === 400) {
      return { error: 'invalid', field: body.field, reason: body.reason, row: body.row };
    }
    if (res.status === 403) return { error: 'forbidden' };
    if (res.status === 402) return { error: 'demo' };
    return { error: 'failed' };
  } catch (err) {
    console.error('Failed to reach the Business Hub numbers:', err);
    return { error: 'failed' };
  }
}

/** Saves one entry, replacing the brand's of the same length and last day. Every member may. */
export async function saveBusinessHubSnapshot(
  brandId: string,
  entry: EntryInput,
): Promise<{ saved: true; replaced: boolean } | BusinessHubWriteError> {
  if (!id.safeParse(brandId).success) return { error: 'invalid' };
  const res = await call(`/${brandId}/snapshots`, {
    method: 'PUT',
    body: JSON.stringify(entry),
  });
  if ('error' in res) return res;
  const body = (await res.json().catch(() => ({}))) as { replaced?: boolean };
  return { saved: true, replaced: body.replaced === true };
}

/**
 * Saves entries from Ansvisor's CSV template (lib/business-hub/csv.ts), all
 * or none, each replacing the brand's of the same length and last day.
 * Every member may.
 */
export async function importBusinessHubSnapshots(
  brandId: string,
  entries: EntryInput[],
): Promise<{ saved: number; replaced: number } | BusinessHubWriteError> {
  if (!id.safeParse(brandId).success || !entries.length || entries.length > 104) {
    return { error: 'invalid' };
  }
  const res = await call(`/${brandId}/snapshots/import`, {
    method: 'POST',
    body: JSON.stringify({ rows: entries }),
  });
  if ('error' in res) return res;
  const body = (await res.json().catch(() => ({}))) as { saved?: number; replaced?: number };
  return { saved: Number(body.saved) || 0, replaced: Number(body.replaced) || 0 };
}

/** Deletes one entry. Admins and managers only (the API refuses anyone else). */
export async function deleteBusinessHubSnapshot(
  entryId: string,
): Promise<{ deleted: true } | BusinessHubWriteError> {
  if (!id.safeParse(entryId).success) return { error: 'invalid' };
  const res = await call(`/snapshots/${entryId}`, { method: 'DELETE' });
  if ('error' in res) return res;
  return { deleted: true };
}

export type { BusinessHubEntry, EntryInput, OursNumbers, PeriodDays };
