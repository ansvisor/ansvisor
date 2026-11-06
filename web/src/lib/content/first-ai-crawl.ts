import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/**
 * Time to first AI crawl (#2142): after a page went live through Send to
 * CMS, the first visit an AI bot made to it, from the AI bot logs the brand
 * sends (AI Traffic's connections). Ingest keeps only verified AI bots
 * (ai-bots.js: a known user agent from its operator's published IP range),
 * so every visit read here is one. Events are kept 90 days; a page that went
 * live before that is read from the bot × page × day counters, to the day.
 * Read in the browser with the person's session: they see their brands'.
 */

/** A page's first AI crawl after it went live: the bot, and when (to the day, from the counters). */
export interface FirstAiCrawl {
  bot: string;
  at: string;
  dayOnly: boolean;
}

/** What the Library shows: whether the brand sends AI bot logs, and each published page's first crawl. */
export interface FirstAiCrawls {
  /** The brand has an AI bot log connection that isn't revoked. */
  logs: boolean;
  /** By draft id: the first crawl, or null when none came yet. */
  byDraft: Map<string, FirstAiCrawl | null>;
}

/** How long ai_bot_events keeps a visit (00183): older ones are counters only. */
const EVENTS_KEPT_DAYS = 90;
/** The most published pages one read looks up. */
export const FIRST_CRAWL_PAGES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A page's key as the bot logs keep it: lower(normalize_page_path(url)).
 * Host, query, fragment and trailing slash removed, escapes decoded where
 * possible, "/" for the home page. Pure.
 */
export function botPageKey(url: string): string {
  let path = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '');
  path = path.split('?')[0].split('#')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Kept as written, as url_decode_safe does.
  }
  path = path.replace(/\/+$/, '');
  return (path || '/').toLowerCase();
}

/** A published page to look up: its draft, its live address and when it went live. */
export interface PublishedPage {
  draftId: string;
  url: string;
  at: string;
}

/**
 * The first AI crawl of each page (up to FIRST_CRAWL_PAGES), for the
 * brand's own logs only: the same path on another brand is another page.
 * A read that fails leaves that page with none, and is logged.
 */
export async function readFirstAiCrawls(
  brandId: string,
  pages: readonly PublishedPage[],
  now = new Date(),
): Promise<FirstAiCrawls> {
  // The AI bot tables aren't in the web's generated types: only the API server read them till now.
  const supabase = createClient() as unknown as SupabaseClient;
  const byDraft = new Map<string, FirstAiCrawl | null>();
  const { data: connections, error } = await supabase
    .from('ai_bot_connections')
    .select('id')
    .eq('brand_id', brandId)
    .is('revoked_at', null)
    .limit(1);
  if (error) console.error('Failed to read the AI bot log connections:', error.message);
  // A brand without logs reads nothing: the Library says to connect them.
  const logs = !error && (connections ?? []).length > 0;
  if (!logs) return { logs, byDraft };

  const eventsSince = now.getTime() - EVENTS_KEPT_DAYS * DAY_MS;
  const firstOf = async (page: PublishedPage): Promise<FirstAiCrawl | null> => {
    const key = botPageKey(page.url);
    const event = await supabase
      .from('ai_bot_events')
      .select('bot, occurred_at')
      .eq('brand_id', brandId)
      .eq('page', key)
      .gte('occurred_at', page.at)
      .order('occurred_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (event.error) throw new Error(event.error.message);
    const first = event.data as { bot: string; occurred_at: string } | null;
    if (first) return { bot: first.bot, at: first.occurred_at, dayOnly: false };
    // Live before the events kept: its first day from the counters.
    if (Date.parse(page.at) >= eventsSince) return null;
    const day = await supabase
      .from('ai_bot_daily')
      .select('bot, day')
      .eq('brand_id', brandId)
      .eq('page', key)
      .gte('day', page.at.slice(0, 10))
      .order('day', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (day.error) throw new Error(day.error.message);
    const counted = day.data as { bot: string; day: string } | null;
    return counted ? { bot: counted.bot, at: counted.day, dayOnly: true } : null;
  };

  await Promise.all(
    pages.slice(0, FIRST_CRAWL_PAGES).map(async (page) => {
      try {
        byDraft.set(page.draftId, await firstOf(page));
      } catch (err) {
        console.error('Failed to read a page’s first AI crawl:', err);
      }
    }),
  );
  return { logs, byDraft };
}

/** How long after it went live, in the unit that reads best: minutes, hours or days. */
export function crawlDelay(
  liveAt: string,
  crawledAt: string,
): { unit: 'minutes' | 'hours' | 'days'; count: number } {
  const minutes = Math.max(0, Math.round((Date.parse(crawledAt) - Date.parse(liveAt)) / 60_000));
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.round(hours / 24) };
}
