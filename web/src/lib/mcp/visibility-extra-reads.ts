import type { McpAuthContext } from '@/lib/mcp-auth';
import { PLANS } from '@/config/plans';
import { PROMPT_RANGE_MAX_DAYS } from '@/config/prompt-options';
import {
  getCitationGaps,
  type CitationGapDomain,
  type CitationsFilters,
  type CompetitorSourceDomain,
} from '@/lib/actions/citations';
import { getCompetitorTimeline } from '@/lib/actions/competitor';
import { getTopicsOverview, type TopicOverviewRow } from '@/lib/actions/topic';
import { getHeadToHeadComparison } from '@/lib/actions/tracking';
import { getTrafficBots, getTrafficGooglePages } from '@/lib/actions/traffic';
import { rollupDayWindow } from '@/lib/citations/rollup-window';
import { expandDateToEndOfDay, utcDay } from '@/lib/dates';
import type { HeadToHeadGroup } from '@/lib/head-to-head';
import {
  opportunities,
  topicStandings,
  type OpportunityStanding,
  type OpportunitySuggestion,
} from '@/lib/insights-opportunities';
import { parseTopicCompetitors, topicHeatmap, type TopicCompetitors } from '@/lib/insights-topics';
import { parseTrendMarkers } from '@/lib/insights-trend';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { asService, planFactsOf } from './chat-facts';
import { brandAllowed, listCompetitorsFor, listPromptSuggestionsFor } from './data';
import { sourcesOf } from './google-reads';
import { PAGE_ROWS, pageOfList, pageWindow, type PageMeta, type PageWords } from './list-page';
import { LOOKUP_MAX, citedDomainKey, hasWords, searchWords } from './lookup';

/**
 * Chat's reads of what Visibility, Prompts, Competitors and AI Traffic show
 * that no other read gives (the owner's rule of 2026-11-16: Chat reads all a
 * page shows): the Topics tab's table, the Query Fan-outs tab outside a
 * skill, a competitor's head-to-head and timeline, the Overview's "Topics vs
 * competitors" map, its trend markers and its Opportunities card, Citations ›
 * Gaps, AI bots and the Search Console pages. Each reads what its page reads,
 * from the page's own function or database function, with the service role
 * once the brand is the caller's (brandAllowed), and from daily rollups or
 * one aggregate in the database: none pages tracked answers or reads them
 * raw. Null for a brand outside the caller's organization or access. Server
 * only.
 */

const DAY_MS = 86_400_000;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** A read's page: how many it holds and where it starts (list-paging.ts's input). */
interface PageParams {
  limit?: number;
  offset?: number;
}

/** A page of `list` under `key`, with its total, offset, next_offset and note. */
function page<T, K extends string>(
  list: readonly T[],
  key: K,
  params: PageParams,
  words: PageWords,
): PageMeta & Record<K, T[]> {
  const { rows, ...meta } = pageOfList(list, params, words);
  return { ...meta, [key]: rows } as PageMeta & Record<K, T[]>;
}

/**
 * A period as the pages pass it: from the first instant of `dateFrom` to the
 * last of `dateTo`. A bare day ("2026-11-02") is a whole UTC day.
 */
function periodOf(dateFrom?: string, dateTo?: string): { from?: string; to?: string } {
  const from =
    dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? `${dateFrom}T00:00:00.000Z` : dateFrom;
  return { from: from || undefined, to: expandDateToEndOfDay(dateTo) };
}

/** The period a read covered, as its result says it. */
const periodWords = (dateFrom?: string, dateTo?: string) => ({
  date_from: dateFrom ?? null,
  date_to: dateTo ?? null,
});

/** A model filter as the Overview passes it: one slug, or a family's slugs with commas. */
function modelList(model?: string): string[] | undefined {
  const list = (model ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  return list.length > 0 ? [...new Set(list)] : undefined;
}

// ─── Prompts › Topics ───────────────────────────────────────────────────────

/** A topic's row as the Topics tab shows it. */
function topicRow(t: TopicOverviewRow) {
  return {
    topic_id: t.id,
    name: t.name,
    prompts: t.promptCount,
    visibility: round1(t.visibilityRate),
    visible_prompts: t.visiblePrompts,
    active_prompts: t.activePrompts,
    visibility_change: t.visibilityChange,
    mentions: t.totalMentions,
    citations: t.totalCitations,
    share_of_voice: t.shareOfVoice,
    top_competitor: t.topCompetitor
      ? { name: t.topCompetitor.name, share_of_voice: t.topCompetitor.sov }
      : null,
    last_run_at: t.lastRunAt,
    trend: t.trendSparkline,
  };
}

/**
 * Prompts › Topics, as the tab reads it (getTopicsOverview: the window's
 * rollups in topics_overview_window, 00536): each active topic's AI
 * Visibility Score, visible and active prompts, change against the window
 * before, mentions, citations, share of voice, top competitor, last run and
 * daily trend, in the tab's default order (AI Visibility Score, highest
 * first), a page at a time; with the tab's cards (best, weakest, biggest
 * gain) over every topic.
 */
export async function getTopicsOverviewFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string } & PageParams,
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const { from, to } = periodOf(params.dateFrom, params.dateTo);
  // All time: the tab's longest range, as its rollups are read for every window (00536).
  const window = from
    ? { from, ...(to ? { to } : {}) }
    : { from: new Date(Date.now() - PROMPT_RANGE_MAX_DAYS * DAY_MS).toISOString() };
  const read = await asService(() => getTopicsOverview(params.brandId, window));
  // The tab's sort: Visibility, highest first; a tie keeps the tab's order (oldest topic first).
  const ranked = [...read.topics].sort((a, b) => b.visibilityRate - a.visibilityRate);
  const measured = read.topics.filter((t) => t.visibilityRate > 0);
  const changed = read.topics.filter((t) => t.visibilityChange !== null);
  const named = (t: TopicOverviewRow | undefined) =>
    t ? { topic_id: t.id, name: t.name, visibility: round1(t.visibilityRate) } : null;
  const gainer = [...changed].sort(
    (a, b) => (b.visibilityChange ?? 0) - (a.visibilityChange ?? 0),
  )[0];
  return {
    period: from
      ? periodWords(params.dateFrom, params.dateTo)
      : { last_days: PROMPT_RANGE_MAX_DAYS },
    summary: {
      topics: read.topics.length,
      best: named([...measured].sort((a, b) => b.visibilityRate - a.visibilityRate)[0]),
      weakest: named([...measured].sort((a, b) => a.visibilityRate - b.visibilityRate)[0]),
      biggest_gain: gainer
        ? { topic_id: gainer.id, name: gainer.name, change: gainer.visibilityChange }
        : null,
      prompts_without_topic: read.unassignedPromptCount,
    },
    // Each topic's trend: its answers that named the brand, in percent, one a day.
    trend_days:
      read.trendDays.length > 0
        ? { from: read.trendDays[0], to: read.trendDays[read.trendDays.length - 1] }
        : null,
    ...page(ranked.map(topicRow), 'topics', params, {
      what: 'topics',
      order: 'highest AI Visibility Score first',
    }),
  };
}

// ─── Prompts › Query Fan-outs, outside a skill ─────────────────────────────

/** The fan-out light read's window: the tab opens on 7 days; a plain question reads 30 at most. */
export const FANOUT_LIGHT_DAYS = 7;
export const FANOUT_LIGHT_MAX_DAYS = 30;
/** Sub-queries named under each prompt in the By prompt view. */
const PROMPT_QUERIES_SHOWN = 5;
/** The brand's active prompts read to mark a sub-query tracked: PostgREST's one page. */
const TRACKED_ROWS = 1000;

export type FanoutView = 'queries' | 'prompts' | 'gaps';

/** A sub-query as the tab keys it: spaces collapsed, trimmed, lower case. */
const queryKey = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Which sub-queries are tracked as prompts: the brand's active prompts'
 * texts, keyed as the tab compares them. `complete` false when the read may
 * have stopped at its page: a sub-query it doesn't hold is then unknown.
 */
async function trackedTexts(brandId: string): Promise<{ keys: Set<string>; complete: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('text, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .eq('is_active', true)
    .limit(TRACKED_ROWS);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { text: string | null }[];
  return {
    keys: new Set(rows.flatMap((row) => (row.text ? [queryKey(row.text)] : []))),
    complete: rows.length < TRACKED_ROWS,
  };
}

/** The engine strip: each engine's distinct sub-queries and answers with fan-out. */
async function fanoutEngines(brandId: string, from: string, to: string) {
  const { data, error } = await supabaseAdmin.rpc('report_query_fanout_engines', {
    p_brand_id: brandId,
    p_date_from: from,
    p_date_to: to,
  });
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as { engine: string; distinct_queries: number; answers_with_fanout: number }[]
  ).map((row) => ({
    engine: row.engine,
    sub_queries: Number(row.distinct_queries),
    answers_with_fanout: Number(row.answers_with_fanout),
  }));
}

/**
 * Every (prompt, sub-query, answers) of the window, summed in the database
 * (brand_prompt_fanout_queries, 00101): one value, never the answers.
 */
async function promptFanoutQueries(brandId: string, since: string) {
  const { data, error } = await supabaseAdmin.rpc('brand_prompt_fanout_queries', {
    p_brand_id: brandId,
    p_since: since,
    p_min_answers: 1,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).flatMap((triple) =>
    Array.isArray(triple) && typeof triple[1] === 'string'
      ? [
          {
            promptId: (triple[0] as string | null) ?? null,
            query: triple[1],
            answers: Number(triple[2]) || 0,
          },
        ]
      : [],
  );
}

/** The brand's prompts' texts, for the ids a page names: its own prompts only. */
async function promptTexts(brandId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .in('id', [...ids])
    .eq('prompt_sets.brand_id', brandId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { id: string; text: string }[]).map((row) => [row.id, row.text]));
}

/**
 * Prompts › Query Fan-outs for a plain question (no skill): the searches AI
 * engines ran behind the brand's tracked answers, over the tab's last 7 days
 * by default and 30 at most. A light read: each view is one or two
 * aggregates in the database over the window (no answer leaves it), where
 * get_fanouts and get_fanout_gaps read the answers page by page inside a
 * skill. As the tab, every engine that answered counts.
 *   - queries: each sub-query, most searched first, with the engines that
 *     ran it, how many answers did, how many prompts' answers, and whether
 *     it is tracked as a prompt; with the engine strip.
 *   - prompts: the By prompt view, each prompt with how many sub-queries its
 *     answers ran, most first, and the most searched of them.
 *   - gaps: the sub-queries whose answers never named the brand (the Action
 *     Center's fan-out detector, ae_fanout_gaps), the most prompts first.
 */
export async function getQueryFanoutsFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number; view?: FanoutView } & PageParams,
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = Math.min(
    Math.max(Math.trunc(params.days ?? FANOUT_LIGHT_DAYS), 1),
    FANOUT_LIGHT_MAX_DAYS,
  );
  const view = params.view ?? 'queries';
  const now = Date.now();
  const to = new Date(now).toISOString();
  const since = new Date(now - days * DAY_MS).toISOString();
  const base = { days, view, date_from: since.slice(0, 10), date_to: to.slice(0, 10) };

  if (view === 'gaps') {
    const [gapsRes, tracked] = await Promise.all([
      supabaseAdmin.rpc('ae_fanout_gaps', { p_brand_id: params.brandId, p_from: since }),
      trackedTexts(params.brandId),
    ]);
    if (gapsRes.error) throw new Error(gapsRes.error.message);
    const gaps = (
      (Array.isArray(gapsRes.data) ? gapsRes.data : []) as Record<string, unknown>[]
    ).map((row) => {
      const query = String(row.query ?? '');
      return {
        query,
        answers: Number(row.results) || 0,
        prompts: Number(row.prompts) || 0,
        answers_naming_only_competitors: Number(row.competitor_only) || 0,
        tracked: tracked.keys.has(queryKey(query)) ? true : tracked.complete ? false : null,
      };
    });
    return {
      ...base,
      gaps_rule:
        'Sub-queries whose answers never named the brand; the 300 with the most prompts at most.',
      ...page(gaps, 'gaps', params, { what: 'fan-out gaps', order: 'most prompts first' }),
    };
  }

  if (view === 'prompts') {
    const [triples, engines] = await Promise.all([
      promptFanoutQueries(params.brandId, since),
      fanoutEngines(params.brandId, since, to),
    ]);
    const byPrompt = new Map<string, { query: string; answers: number }[]>();
    for (const t of triples) {
      if (!t.promptId) continue;
      byPrompt.set(t.promptId, [
        ...(byPrompt.get(t.promptId) ?? []),
        { query: t.query, answers: t.answers },
      ]);
    }
    // The By prompt view's rank: the most sub-queries first.
    const ranked = [...byPrompt.entries()]
      .map(([promptId, queries]) => ({
        promptId,
        queries: [...queries].sort(
          (a, b) => b.answers - a.answers || a.query.localeCompare(b.query),
        ),
      }))
      .sort((a, b) => b.queries.length - a.queries.length || a.promptId.localeCompare(b.promptId));
    const { rows, ...meta } = pageOfList(ranked, params, {
      what: 'prompts whose answers ran searches',
      order: 'most sub-queries first',
    });
    const texts = await promptTexts(
      params.brandId,
      rows.map((p) => p.promptId),
    );
    return {
      ...base,
      engines,
      ...meta,
      prompts: rows.map((p) => ({
        prompt_id: p.promptId,
        text: texts.get(p.promptId) ?? null,
        sub_queries: p.queries.length,
        top_sub_queries: p.queries.slice(0, PROMPT_QUERIES_SHOWN).map((q) => ({
          query: q.query,
          times_searched: q.answers,
        })),
      })),
    };
  }

  const { offset, limit } = pageWindow(params);
  const [triples, engines, named, tracked] = await Promise.all([
    promptFanoutQueries(params.brandId, since),
    fanoutEngines(params.brandId, since, to),
    // The engines that ran this page's sub-queries: the tab's engine column.
    supabaseAdmin.rpc('report_query_fanout', {
      p_brand_id: params.brandId,
      p_date_from: since,
      p_date_to: to,
      p_limit: offset + limit,
    }),
    trackedTexts(params.brandId),
  ]);
  if (named.error) throw new Error(named.error.message);
  // The sub-queries, most searched first: each answer once, summed over the prompts.
  const byQuery = new Map<string, { query: string; answers: number; prompts: number }>();
  for (const t of triples) {
    const key = queryKey(t.query);
    const acc = byQuery.get(key) ?? { query: t.query, answers: 0, prompts: 0 };
    acc.answers += t.answers;
    if (t.promptId) acc.prompts += 1;
    byQuery.set(key, acc);
  }
  const ranked = [...byQuery.entries()].sort(
    (a, b) => b[1].answers - a[1].answers || a[0].localeCompare(b[0]),
  );
  const enginesOf = new Map(
    ((named.data ?? []) as { query: string; engines: string[] | null }[]).map((row) => [
      queryKey(row.query),
      row.engines ?? [],
    ]),
  );
  return {
    ...base,
    engines,
    ...page(
      ranked.map(([key, q]) => ({
        query: q.query,
        times_searched: q.answers,
        prompts: q.prompts,
        engines: enginesOf.get(key) ?? null,
        tracked: tracked.keys.has(key) ? true : tracked.complete ? false : null,
      })),
      'sub_queries',
      params,
      { what: 'sub-queries', order: 'most searched first' },
    ),
  };
}

// ─── Competitors › head-to-head ─────────────────────────────────────────────

/** Which of the head-to-head's prompts a page lists: the losing ones, the winning ones, or all. */
export type HeadToHeadSide = 'losing' | 'winning' | 'all';

/** A timeline's events listed, newest first. */
const TIMELINE_EVENTS_SHOWN = 10;

interface CompetitorRef {
  id: string;
  name: string;
  domain: string;
}

/** A name with the suffix Turkish puts after an apostrophe dropped: "Acme CRM'e" → "Acme CRM". */
const withoutSuffixes = (text: string) => text.replace(/['’]\p{L}+(?=\s|$)/gu, '').trim();

/**
 * The competitor a person named, among the brand's own: by its id, else by
 * its name or its domain as written (a Turkish suffix aside), else by its
 * name's words when only one has them. What names none (or several) says
 * so; never the closest.
 */
export function pickCompetitor(
  competitors: readonly CompetitorRef[],
  asked: { id?: string; name?: string },
): { found: CompetitorRef } | { choices: CompetitorRef[] } | { notFound: string } | null {
  if (asked.id) {
    const found = competitors.find((c) => c.id.toLowerCase() === asked.id!.toLowerCase());
    return found ? { found } : { notFound: asked.id };
  }
  const text = withoutSuffixes(asked.name ?? '');
  if (!text) return null;
  const lower = text.toLowerCase();
  const byName = competitors.filter((c) => c.name.trim().toLowerCase() === lower);
  if (byName.length === 1) return { found: byName[0] };
  const domain = citedDomainKey(text);
  const byDomain = domain
    ? competitors.filter((c) => {
        const own = citedDomainKey(c.domain);
        return (
          own !== null &&
          (own === domain || own.endsWith(`.${domain}`) || domain.endsWith(`.${own}`))
        );
      })
    : [];
  if (byDomain.length === 1) return { found: byDomain[0] };
  const words = searchWords(text);
  const byWords =
    byName.length > 1
      ? byName
      : competitors.filter((c) => words.length > 0 && hasWords(`${c.name} ${c.domain}`, words));
  if (byWords.length === 1) return { found: byWords[0] };
  if (byWords.length > 1) return { choices: byWords.slice(0, LOOKUP_MAX) };
  return { notFound: text };
}

/** A head-to-head prompt as the page's tables show it. */
function headToHeadRow(g: HeadToHeadGroup) {
  return {
    prompt_id: g.promptId,
    prompt: g.promptText,
    platform: g.platform,
    model: g.modelUsed || null,
    region: g.region ?? null,
    runs: g.runs,
    brand_visibility: Math.round(g.brandScore),
    competitor_visibility: Math.round(g.competitorScore),
    difference: Math.round(g.diff),
    last_run_at: g.latestAt,
  };
}

/**
 * Competitors' head-to-head with one competitor, as the page reads it
 * (getHeadToHeadComparison, head_to_head_daily's rollups, 00169, every
 * answer): the brand's and the competitor's average visibility, overall and
 * by AI platform, and each (prompt, platform, model, region) with both
 * scores; `side` lists the losing ones (the Gaps tab's order: biggest gap
 * first), the winning ones (Strengths: biggest lead first) or all (the
 * page's list: most recently run first), a page at a time. With the
 * competitor's timeline (getCompetitorTimeline: mentioning answers per week
 * from the daily rollups, and its pages' events). The competitor by its id
 * or by what the person called it, among the brand's own.
 */
export async function getCompetitorHeadToHeadFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    competitorId?: string;
    competitor?: string;
    side?: HeadToHeadSide;
  } & PageParams,
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const competitors = (await listCompetitorsFor(auth, params.brandId)) ?? [];
  const where = "this brand's competitors (Competitors page)";
  const asked = params.competitorId || params.competitor?.trim();
  if (competitors.length === 0) {
    return {
      competitors: [],
      note: 'This brand has no competitors set up yet: they are added on the Competitors page. Say so plainly.',
    };
  }
  const picked = asked
    ? pickCompetitor(competitors, { id: params.competitorId, name: params.competitor })
    : competitors.length === 1
      ? { found: competitors[0] }
      : null;
  if (!picked || 'choices' in picked) {
    const choices = picked && 'choices' in picked ? picked.choices : competitors;
    return {
      note: `${picked ? `"${asked}" names ${choices.length} competitors` : 'Name the competitor'}: read again with competitor_id, one of these; never pick one for the person.`,
      competitors: choices
        .slice(0, 50)
        .map((c) => ({ competitor_id: c.id, name: c.name, domain: c.domain })),
    };
  }
  if ('notFound' in picked) {
    return {
      not_found: [picked.notFound],
      note: `No competitor of this brand is "${picked.notFound}". Looked in ${where}. Say so plainly; never offer another competitor as the closest. It can be added on the Competitors page.`,
    };
  }

  const competitor = picked.found;
  const [h2h, timeline] = await Promise.all([
    asService(() => getHeadToHeadComparison(params.brandId, competitor.id)),
    asService(() => getCompetitorTimeline(params.brandId, competitor.id)),
  ]);
  const side = params.side ?? 'all';
  const byDiff = [...h2h.groups].sort((a, b) => a.diff - b.diff);
  const losing = byDiff.filter((g) => g.diff < 0);
  const winning = byDiff.filter((g) => g.diff > 0).reverse();
  const listed = side === 'losing' ? losing : side === 'winning' ? winning : h2h.groups;
  const words: Record<HeadToHeadSide, PageWords> = {
    losing: { what: 'prompts where the competitor is ahead', order: 'biggest gap first' },
    winning: { what: 'prompts where the brand is ahead', order: 'biggest lead first' },
    all: { what: 'prompts compared', order: 'most recently run first' },
  };
  return {
    competitor: { competitor_id: competitor.id, name: competitor.name, domain: competitor.domain },
    period: 'every tracked answer',
    summary: {
      brand_visibility: h2h.brandAvg,
      competitor_visibility: h2h.competitorAvg,
      by_platform: h2h.platformRows.map((p) => ({
        platform: p.platform,
        brand_visibility: p.brandScore,
        competitor_visibility: p.competitorScore,
        difference: p.diff,
      })),
      prompts_compared: h2h.groups.length,
      competitor_ahead: losing.length,
      brand_ahead: winning.length,
    },
    side,
    ...page(listed.map(headToHeadRow), 'prompts', params, words[side]),
    timeline: {
      weeks: timeline.weeks.map((w) => ({
        week: w.week,
        brand_mentioning_answers: w.brand,
        competitor_mentioning_answers: w.competitor,
      })),
      events_total: timeline.events.length,
      events: timeline.events.slice(0, TIMELINE_EVENTS_SHOWN).map((e) => ({
        kind: e.kind,
        at: e.at,
        url: e.url,
        answers: e.answers,
        gained: e.gained.map((c) => c.label),
        lost: e.lost.map((c) => c.label),
      })),
    },
  };
}

// ─── Visibility › Overview: Topics vs competitors, trend markers, Opportunities

/** The Overview's whole UTC days for a period, as its rollup reads take them. */
function dayWindow(dateFrom?: string, dateTo?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const dayTo = utcDay(dateTo) ?? today;
  const dayFrom =
    utcDay(dateFrom) ??
    new Date(Date.parse(`${dayTo}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
  return { dayFrom, dayTo };
}

/** "Topics vs competitors"' data (insights_topic_competitors_daily, 00137); null before its rollups. */
async function topicCompetitors(
  brandId: string,
  days: { dayFrom: string; dayTo: string },
  filters: { model?: string; region?: string },
): Promise<TopicCompetitors[] | null> {
  const { data, error } = await supabaseAdmin.rpc('insights_topic_competitors_daily', {
    p_brand_id: brandId,
    p_day_from: days.dayFrom,
    p_day_to: days.dayTo,
    p_models: modelList(filters.model),
    p_region: filters.region || undefined,
  });
  if (error) throw new Error(error.message);
  return parseTopicCompetitors(data);
}

/**
 * Visibility › Overview's "Topics vs competitors" (VIS-010) and the trend's
 * markers (VIS-007), as the Overview reads them: per active topic, the
 * brand's and each competitor's Visibility score over the brand's answers in
 * the topic, the leader and the brand's gap to it (the map's order: topics
 * the brand leads, then the ones it trails, biggest gap first, then those
 * with too few answers), over whole UTC days; every live competitor is a
 * column here, where the map shows the trend's (pinned, or the strongest
 * four). And the days prompts were added in the period, with the AI
 * visibility KPI's goal.
 */
export async function getTopicCompetitorMapFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    dateFrom?: string;
    dateTo?: string;
    model?: string;
    region?: string;
  } & PageParams,
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = dayWindow(params.dateFrom, params.dateTo);
  const [topics, competitors, markers, kpi] = await Promise.all([
    topicCompetitors(params.brandId, days, params),
    listCompetitorsFor(auth, params.brandId),
    supabaseAdmin.rpc('insights_trend_markers', {
      p_brand_id: params.brandId,
      p_from: `${days.dayFrom}T00:00:00Z`,
      p_to: `${days.dayTo}T23:59:59.999Z`,
    }),
    supabaseAdmin
      .from('kpi_definitions')
      .select('target')
      .eq('brand_id', params.brandId)
      .eq('kpi_key', 'ai_visibility')
      .eq('is_active', true)
      .maybeSingle(),
  ]);
  if (markers.error) throw new Error(markers.error.message);
  const names = new Map((competitors ?? []).map((c) => [c.id, c.name]));
  const trendMarkers = {
    prompts_added: parseTrendMarkers(markers.data).promptsAdded,
    goal: kpi.data ? Number((kpi.data as { target: unknown }).target) : null,
  };
  const base = {
    period: { day_from: days.dayFrom, day_to: days.dayTo },
    trend_markers: trendMarkers,
  };
  if (!topics) {
    return {
      ...base,
      note: "Topics vs competitors isn't ready for this brand yet: its daily figures are still being filled. Say so, and use get_topics_overview for each topic's figures.",
      topics: [],
    };
  }
  const ids = [...new Set(topics.flatMap((t) => Object.keys(t.competitors)))];
  const columns = ['you', ...ids];
  // Each column's name once: two competitors of one name keep apart.
  const columnNames = new Map<string, string>();
  for (const key of columns) {
    const name = key === 'you' ? 'You' : (names.get(key) ?? 'Competitor');
    const taken = new Set(columnNames.values());
    let unique = name;
    for (let n = 2; taken.has(unique); n++) unique = `${name} (${n})`;
    columnNames.set(key, unique);
  }
  const rows = topicHeatmap(topics, columns).map((row) => ({
    topic_id: row.topicId,
    name: row.name,
    status: row.status === 'lowSample' ? 'too_few_answers' : row.status,
    leader: columnNames.get(row.leader)!,
    gap: row.gap,
    // A competitor the topic's answers never named scores 0 there: left out.
    scores: Object.fromEntries(
      columns.flatMap((key, i) =>
        key === 'you' || row.scores[i] > 0 ? [[columnNames.get(key)!, row.scores[i]]] : [],
      ),
    ),
  }));
  return {
    ...base,
    scores_rule: 'A competitor missing from a topic’s scores scored 0 there.',
    ...page(rows, 'topics', params, {
      what: 'topics',
      order:
        'topics the brand leads, then those it trails (biggest gap first), then those with too few answers',
    }),
  };
}

/** An Opportunities item's standing in words the model can repeat. */
function standingWords(standing: OpportunityStanding) {
  switch (standing.kind) {
    case 'competitor':
      return {
        leader: standing.name ?? 'a competitor',
        leader_score: standing.score,
        gap: standing.gap,
      };
    case 'you':
      return { leader: 'the brand' };
    case 'notTracked':
      return { leader: null, not_tracked: true };
    default:
      return { leader: null };
  }
}

/** PostgREST's one page: a read of tracked topics that fills it may be cut. */
const TRACKED_TOPIC_ROWS = 1000;

/**
 * Visibility › Overview's Opportunities card (VIS-011), as the card ranks
 * them: the stored prompt suggestions (Business Hub's aside) over the
 * relevance threshold, a topic's together, ranked by relevance × demand ×
 * gap, each with its monthly AI searches and who leads its topic in the
 * period (the Topics vs competitors figures). Relevance itself is never
 * shown. A page at a time.
 */
export async function getVisibilityOpportunitiesFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    dateFrom?: string;
    dateTo?: string;
    model?: string;
    region?: string;
  } & PageParams,
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = dayWindow(params.dateFrom, params.dateTo);
  const [read, topics, competitors] = await Promise.all([
    listPromptSuggestionsFor(auth, params.brandId),
    topicCompetitors(params.brandId, days, params),
    listCompetitorsFor(auth, params.brandId),
  ]);
  const suggestions: OpportunitySuggestion[] = (read?.suggestions ?? [])
    .filter((s) => s.source !== 'business_hub')
    .map((s) => ({
      id: s.id,
      text: s.suggested_text,
      topicId: s.topic_id,
      topicName: s.topic_name,
      estVolume: s.est_volume,
      relevance: s.relevance,
    }));
  const topicIds = [...new Set(suggestions.flatMap((s) => (s.topicId ? [s.topicId] : [])))];
  let tracked: string[] | null = [];
  if (topicIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('prompts')
      .select('topic_id, prompt_sets!inner(brand_id)')
      .in('topic_id', topicIds)
      .eq('prompt_sets.brand_id', params.brandId)
      .eq('is_active', true)
      .limit(TRACKED_TOPIC_ROWS);
    // Unknown, not "none": a failed or cut read would call tracked topics untracked.
    tracked =
      error || (data?.length ?? 0) >= TRACKED_TOPIC_ROWS
        ? null
        : [...new Set(((data ?? []) as { topic_id: string }[]).map((r) => r.topic_id))];
  }
  const names = Object.fromEntries((competitors ?? []).map((c) => [c.id, c.name]));
  const result = opportunities(
    suggestions,
    topicStandings(topics, names, tracked && new Set(tracked)),
  );
  const period = { day_from: days.dayFrom, day_to: days.dayTo };
  if (result.status !== 'ready') {
    const why = {
      empty: 'No prompt suggestions are stored for this brand: Prompts › Suggestions makes them.',
      unrated:
        'The stored suggestions were made before they were rated for fit: refreshing them in Prompts › Suggestions rates them.',
      noneRelevant: 'None of the stored suggestions fits the brand well enough to show.',
    }[result.status];
    return { period, status: result.status, note: why, opportunities: [] };
  }
  return {
    period,
    status: result.status,
    ...page(
      result.items.map((item) => ({
        kind: item.kind,
        title: item.title,
        topic_id: item.topicId,
        prompts_to_track: item.suggestionIds.length,
        monthly_ai_searches: item.volume,
        ...standingWords(item.standing),
      })),
      'opportunities',
      params,
      { what: 'opportunities', order: 'best first, as the card ranks them' },
    ),
  };
}

// ─── Citations › Gaps ───────────────────────────────────────────────────────

/** A Gap list row as the tab shows it. */
function gapDomainRow(row: CitationGapDomain) {
  return {
    domain: row.domain,
    source_type: row.category,
    competitor_answers: row.competitorAnswers,
    competitors: row.competitors,
    strength: row.strength,
  };
}

/** A By competitor row as the tab shows it. */
function competitorSourceRow(row: CompetitorSourceDomain) {
  return {
    domain: row.domain,
    source_type: row.category,
    answers_feeding: row.answersFeeding,
    also_cites_brand: row.alsoCitesUs,
    strength: row.strength,
  };
}

/** What the Gap list holds, in words the model can repeat (help/citations/competitor-gaps.md). */
const GAP_RULE =
  'Third-party domains cited in at least 2 answers that name a competitor while the brand is absent, and in no answer where the brand appears. Strength weighs each answer by how many sources it had. The tab lists the strongest 100.';

/**
 * Citations › Gaps (Competitor Gaps), as the tab reads it (getCitationGaps:
 * citation_gap_domains_daily and citation_competitor_sources_daily over the
 * daily rollups, 00203, which let the service role through since 00541):
 * the Gap list, third-party domains that cite competitors but not the
 * brand, strongest first (the tab's 100 at most), a page at a time; with a
 * competitor, the By competitor view, the third-party domains cited in the
 * answers naming it, strongest first. Over the period's whole UTC days, as
 * the tab reads a range it is given; all time with none (Chat sends none
 * only for an all-time question). Platforms, region and topic filter as the
 * tab's do; a topic or competitor that isn't the brand's is not found.
 */
export async function getCitationGapsFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    dateFrom?: string;
    dateTo?: string;
    model?: string;
    region?: string;
    topicId?: string;
    competitorId?: string;
  } & PageParams,
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  if (params.topicId) {
    const { data, error } = await supabaseAdmin
      .from('topics')
      .select('id, brands!inner(organization_id)')
      .eq('id', params.topicId)
      .eq('brand_id', params.brandId)
      .eq('brands.organization_id', auth.organizationId!)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        not_found: [params.topicId],
        note: 'No topic of this brand has this id. Say so plainly; list_topics has its topics.',
      };
    }
  }
  let competitor: { id: string; name: string } | null = null;
  if (params.competitorId) {
    const asked = params.competitorId.toLowerCase();
    const own = (await listCompetitorsFor(auth, params.brandId)) ?? [];
    competitor = own.find((c) => c.id.toLowerCase() === asked) ?? null;
    if (!competitor) {
      return {
        not_found: [params.competitorId],
        note: "No competitor of this brand has this id. Say so plainly; never offer another competitor as the closest. list_competitors has the brand's.",
      };
    }
  }

  // A range as the tab passes a custom one; none, the tab's All time.
  const ranged = Boolean(params.dateFrom || params.dateTo);
  const filters: CitationsFilters = {
    datePreset: ranged ? 'custom' : 'all',
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    platforms: params.model ? [params.model] : undefined,
    regions: params.region ? [params.region] : undefined,
    topicIds: params.topicId ? [params.topicId] : undefined,
  };
  const days = ranged ? rollupDayWindow(filters) : null;
  const gaps = await asService(() => getCitationGaps(params.brandId, filters));
  const base = {
    period:
      days && days !== 'latest-run'
        ? { day_from: days.dayFrom ?? null, day_to: days.dayTo ?? null }
        : 'all time',
    answers: gaps.totalAnswers,
    answers_with_brand: gaps.ourAnswerCount,
    low_visibility: gaps.lowVisibility,
    ...(gaps.lowVisibility
      ? {
          low_visibility_note:
            'The brand is in fewer than 1 answer in 10 here, so the list may be broad: the tab says to work on baseline visibility first.',
        }
      : {}),
    gap_rule: GAP_RULE,
    // The tab's competitor picker: those with a cited source, by name.
    competitors: gaps.competitors.map((c) => ({
      competitor_id: c.id,
      name: c.name,
      source_domains: gaps.byCompetitor[c.id]?.length ?? 0,
    })),
  };
  if (competitor) {
    return {
      ...base,
      view: 'by_competitor',
      competitor: { competitor_id: competitor.id, name: competitor.name },
      ...page(
        (gaps.byCompetitor[competitor.id] ?? []).map(competitorSourceRow),
        'source_domains',
        params,
        {
          what: `third-party domains cited in answers naming ${competitor.name}`,
          order: 'strongest first',
        },
      ),
    };
  }
  return {
    ...base,
    view: 'gap_list',
    ...page(gaps.gapDomains.map(gapDomainRow), 'gap_domains', params, {
      what: 'gap domains',
      order: 'strongest first',
    }),
  };
}

// ─── AI Traffic: AI bots, Search Console pages ──────────────────────────────

/** Pages each AI Traffic read lists: the page shows 10, Chat a page's 50 (pages_total counts all). */
const TRAFFIC_PAGES_SHOWN = PAGE_ROWS;

/**
 * Whether the plan has the AI bot report, as the page decides (lib/ai-bots.ts
 * reportLocked): Starter's has none; without an active plan, the plan it was
 * on decides.
 */
async function botReportLocked(organizationId: string): Promise<boolean> {
  const facts = await planFactsOf(organizationId);
  if (facts.selfHosted) return false;
  const own = PLANS[facts.planId]?.limits.maxBotEventsPerMonth ?? 0;
  return facts.writable ? facts.limits.maxBotEventsPerMonth === 0 : own === 0;
}

/**
 * AI Referral Traffic's "AI bots reading your site" (AT-011), as the page
 * reads it (getTrafficBots, ai_bot_report over the daily bot rollups, 00190):
 * verified AI-bot requests in the period by type (training, search index,
 * user fetch) and by bot, with pages and when each last came; the most read
 * pages with each type's last read; and the cited pages no search bot read
 * in 30 days. Locked on a plan without the report (Starter), as the page.
 */
export async function getAiBotsFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string; limit?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  if (await botReportLocked(auth.organizationId!)) {
    return {
      locked: true,
      needs: 'growth',
      note: "The plan doesn't include the AI bot report: Growth and up do. Say so in one sentence.",
    };
  }
  const window = periodOf(params.dateFrom, params.dateTo);
  const [report, connections] = await Promise.all([
    asService(() =>
      getTrafficBots(
        params.brandId,
        { dateFrom: window.from, dateTo: window.to },
        { limit: params.limit ?? TRAFFIC_PAGES_SHOWN },
      ),
    ),
    supabaseAdmin
      .from('ai_bot_connections')
      .select('id')
      .eq('brand_id', params.brandId)
      .is('revoked_at', null)
      .limit(1),
  ]);
  if (connections.error) throw new Error(connections.error.message);
  const connected = (connections.data ?? []).length > 0;
  // The section's states: the brand's data, waiting for a first request, or nothing connected.
  const state = report.lastSeen ? 'data' : connected ? 'waiting' : 'not_connected';
  return {
    state,
    period: periodWords(params.dateFrom, params.dateTo),
    since: report.since,
    first_day: report.firstDay,
    last_seen: report.lastSeen,
    by_type: report.types,
    by_bot: report.bots,
    pages_total: report.pageCount,
    pages: report.pages.map((p) => ({
      page: p.page,
      hits: p.hits,
      training_last: p.trainingLast,
      search_last: p.searchLast,
      user_last: p.userLast,
    })),
    uncrawled_alert: report.alertState,
    cited_pages_no_search_bot_read_total: report.uncrawledCount,
    cited_pages_no_search_bot_read: report.uncrawled,
  };
}

/**
 * AI Referral Traffic's "Is AI taking Google clicks?" (AT-008), as the page
 * reads it (getTrafficGooglePages, ai_traffic_google_pages over Search
 * Console's daily page figures, 00181): pages whose impressions rose 15% or
 * more while their click-through fell 20% or more against the period
 * before, most clicks lost first, over the period's length ending on the
 * last day Google reported. Or that Search Console isn't connected.
 */
export async function getGscPagesFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string; limit?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  if (!(await sourcesOf(params.brandId)).gsc) {
    return { connected: false, source_lag: '2–3 days' };
  }
  const window = periodOf(params.dateFrom, params.dateTo);
  const read = await asService(() =>
    getTrafficGooglePages(
      params.brandId,
      { dateFrom: window.from, dateTo: window.to },
      { limit: params.limit ?? TRAFFIC_PAGES_SHOWN },
    ),
  );
  return {
    connected: true,
    since: read.since,
    until: read.until,
    compared_with: { since: read.prevSince, until: read.prevUntil },
    // The history doesn't reach the period before: nothing is compared.
    incomplete: read.incomplete,
    pages_total: read.count,
    pages: read.rows.map((r) => ({
      page: r.page,
      url: r.url,
      impressions: r.impressions,
      previous_impressions: r.prevImpressions,
      clicks: r.clicks,
      previous_clicks: r.prevClicks,
      prompt_id: r.promptId,
    })),
    data_as_of: read.lastDay,
    source_lag: '2–3 days',
  };
}
