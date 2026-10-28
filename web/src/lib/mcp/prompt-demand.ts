import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * A prompt's real demand (PROMPT-014, 00370) for get_prompt_volumes, beside
 * its estimated AI volume: the signs people really ask it, each with the day
 * it was read, and the level they come to, as the prompt's Demand card shows
 * them. The server's nightly sweep writes them: Search Console every night,
 * Google Trends, People Also Ask and YouTube about once a week.
 */
export interface PromptDemand {
  /** high / medium / low, from the signals read; null until one was. */
  level: 'high' | 'medium' | 'low' | null;
  /** How many of the four signals were read (0–4). */
  signals_read: number;
  /** The keyword the paid signals were read for: the volume analysis's top one. */
  keyword: string | null;
  updated_at: string | null;
  /** The brand's matching Search Console queries over the last 28 days. */
  search_console: {
    impressions: number;
    clicks: number;
    queries: number;
    top_query: string | null;
    read_at: string | null;
  } | null;
  /** Google Trends for the keyword over 12 months. */
  google_trends: {
    trend: 'rising' | 'steady' | 'falling' | null;
    /** Change from the first weeks to the last, in percent; null without a base. */
    change_percent: number | null;
    read_at: string | null;
  } | null;
  /** The People Also Ask questions Google lists for the keyword. */
  people_also_ask: { questions: string[]; read_at: string | null } | null;
  /** The videos YouTube lists for the keyword, and their views. */
  youtube: { videos: number; views: number; read_at: string | null } | null;
}

type Json = Record<string, unknown> | null | undefined;

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A prompt_demand row as get_prompt_volumes returns it. */
export function promptDemandOf(row: Record<string, unknown>): PromptDemand {
  const gsc = object(row.gsc);
  const trends = object(row.trends);
  const paa = object(row.paa);
  const youtube = object(row.youtube);
  const level = text(row.level);
  const trend = text(trends?.trend);
  return {
    level: level === 'high' || level === 'medium' || level === 'low' ? level : null,
    signals_read: num(row.signals),
    keyword: text(row.keyword),
    updated_at: text(row.updated_at),
    search_console: gsc
      ? {
          impressions: num(gsc.impressions),
          clicks: num(gsc.clicks),
          queries: num(gsc.queries),
          top_query: text(object(gsc.top)?.query),
          read_at: text(gsc.at),
        }
      : null,
    google_trends: trends
      ? {
          trend: trend === 'rising' || trend === 'steady' || trend === 'falling' ? trend : null,
          change_percent: trends.change == null ? null : num(trends.change),
          read_at: text(trends.at),
        }
      : null,
    people_also_ask: paa
      ? {
          questions: (Array.isArray(paa.questions) ? paa.questions : [])
            .map((q) => text(object(q)?.question))
            .filter((q): q is string => q !== null),
          read_at: text(paa.at),
        }
      : null,
    youtube: youtube
      ? { videos: num(youtube.videos), views: num(youtube.views), read_at: text(youtube.at) }
      : null,
  };
}

/** Prompt ids per `.in()` filter, so the request stays short. */
const DEMAND_CHUNK = 100;

/** The prompts' real demand, by prompt id; a prompt never read has none. */
export async function readPromptDemand(promptIds: string[]): Promise<Map<string, PromptDemand>> {
  const chunks: string[][] = [];
  for (let i = 0; i < promptIds.length; i += DEMAND_CHUNK) {
    chunks.push(promptIds.slice(i, i + DEMAND_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((ids) =>
      supabaseAdmin
        .from('prompt_demand')
        .select('prompt_id, level, signals, keyword, gsc, trends, paa, youtube, updated_at')
        .in('prompt_id', ids),
    ),
  );
  const demand = new Map<string, PromptDemand>();
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      demand.set(row.prompt_id as string, promptDemandOf(row));
    }
  }
  return demand;
}
