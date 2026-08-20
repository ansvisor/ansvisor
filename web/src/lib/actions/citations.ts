'use server';

import { createClient } from '@/lib/supabase/server';
import { expandDateToEndOfDay } from '@/lib/dates';
import type { Citation, CompetitorMention } from '@/types';
import {
  classifyDomain,
  extractHostname,
  normalizeDomain,
  type SourceCategory,
  SOURCE_CATEGORIES,
} from '@/lib/citations/classify';
import { classifyArticleType } from '@/lib/citations/article-type';
import { citationUrlMatchKey, normalizeCitationUrl } from '@/lib/citations/normalize';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CitationsDatePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

export interface CitationsFilters {
  datePreset: CitationsDatePreset;
  dateFrom?: string;
  dateTo?: string;
  platforms?: string[];
  topicIds?: string[];
  promptIds?: string[];
  regions?: string[];
  excludeOwnDomain?: boolean;
  competitorOnly?: boolean;
  ownOnly?: boolean;
}

export interface CitationArticleTypeCount {
  type: string;
  count: number;
}

export interface CitationDomainRow {
  domain: string;
  category: SourceCategory;
  models: string[];
  totalCitations: number;
  avgCitationsPerResult: number;
  resultsCiting: number;
  usagePct: number;
  articleTypes: CitationArticleTypeCount[];
}

export interface CitationUrlRow {
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  models: string[];
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
  articleType: string | null;
}

export interface CitationsSourceBreakdown {
  category: SourceCategory;
  count: number;
  pct: number;
}

export interface CitationsOverview {
  rows: CitationDomainRow[];
  urlRows: CitationUrlRow[];
  totals: {
    domains: number;
    urls: number;
    citations: number;
    results: number;
    avgCitationsPerResult: number;
  };
  sourceTypeBreakdown: CitationsSourceBreakdown[];
  /** Distinct regions observed on results in the scanned (filtered) window (#598). */
  availableRegions: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDateRange(filters: CitationsFilters): { from?: string; to?: string } {
  if (filters.datePreset === 'custom') {
    return { from: filters.dateFrom, to: filters.dateTo };
  }
  if (filters.datePreset === 'all') {
    return {};
  }
  const to = new Date();
  const from = new Date();
  switch (filters.datePreset) {
    case '24h':
      from.setHours(from.getHours() - 24);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    case '90d':
      from.setDate(from.getDate() - 90);
      break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// ─── Main action ──────────────────────────────────────────────────────────────

/**
 * Apply the platform/model filter to `prompt_results.model_used`.
 *
 * Supports both a single slug (`gpt-5-5`) and a comma-joined family
 * (`gpt-5-3-mini,gpt-5-5`) so the UI can filter an entire provider family
 * from one dropdown option.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyModelFilter<T extends { eq: any; in: any }>(
  query: T,
  models: string[] | undefined,
): T {
  if (!models || models.length === 0) return query;

  const list = Array.from(
    new Set(
      models.flatMap((model) =>
        model
          .split(',')
          .map((slug) => slug.trim())
          .filter(Boolean),
      ),
    ),
  );

  if (list.length <= 1) return query.eq('model_used', list[0] ?? models[0]);
  return query.in('model_used', list);
}

/**
 * PostgREST silently caps un-paginated selects at 1000 rows, which quietly
 * truncated every citations aggregation on brands with more than 1000 results
 * in the selected window (the overview literally reported `results: 1000`).
 * Page through the filtered window instead, feeding each batch to `onBatch` so
 * full citation payloads never accumulate in memory. Returns the total rows
 * scanned. The hard row ceiling bounds the `all` preset on huge brands.
 */
const CITATIONS_SCAN_PAGE_SIZE = 1000;
const CITATIONS_SCAN_MAX_ROWS = 50_000;

async function scanFilteredResults<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  filters: CitationsFilters,
  select: string,
  onBatch: (batch: T[]) => void,
): Promise<number> {
  // Resolve topic → prompt ids once, not per page.
  let topicPromptIds: string[] | null = null;
  if (filters.topicIds && filters.topicIds.length > 0) {
    const { data: topicPrompts } = await supabase
      .from('prompts')
      .select('id')
      .in('topic_id', filters.topicIds);
    topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
  }

  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  let total = 0;
  for (let offset = 0; offset < CITATIONS_SCAN_MAX_ROWS; offset += CITATIONS_SCAN_PAGE_SIZE) {
    let query = supabase
      .from('prompt_results')
      .select(select)
      .eq('brand_id', brandId)
      // #155 — chatgpt-shopping rows are isolated from analytical aggregates.
      // The insights KPIs already exclude them; without this, the Citations
      // page counted a superset of what the KPI counts.
      .neq('platform', 'chatgpt-shopping');
    if (from) query = query.gte('created_at', from);
    if (expandedTo) query = query.lte('created_at', expandedTo);
    if (filters.platforms && filters.platforms.length > 0) {
      query = applyModelFilter(query, filters.platforms);
    }
    if (filters.regions && filters.regions.length > 0) {
      query = query.in('region', filters.regions);
    }
    if (filters.promptIds && filters.promptIds.length > 0) {
      query = query.in('prompt_id', filters.promptIds);
    }
    if (topicPromptIds) {
      query = query.in(
        'prompt_id',
        topicPromptIds.length > 0 ? topicPromptIds : ['00000000-0000-0000-0000-000000000000'],
      );
    }

    const { data, error } = await query
      // Deterministic order so .range() pages don't shuffle between requests.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + CITATIONS_SCAN_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as unknown as T[];
    total += batch.length;
    if (batch.length > 0) onBatch(batch);
    if (batch.length < CITATIONS_SCAN_PAGE_SIZE) break;
  }
  return total;
}

/** URL rows the overview asks for. The table paginates a hundred at a time. */
const CITATIONS_URL_LIMIT = 2000;

/**
 * Arguments shared by the three aggregate functions.
 *
 * Absent filters are `undefined`, which PostgREST omits from the request
 * entirely, so each function falls back to its own default — `null`, meaning
 * no filter. That is the same convention the insights RPCs already use.
 */
function overviewArgs(brandId: string, filters: CitationsFilters, topicPromptIds: string[] | null) {
  const { from, to } = resolveDateRange(filters);
  const promptIds =
    filters.promptIds && filters.promptIds.length > 0 ? filters.promptIds : undefined;

  return {
    p_brand_id: brandId,
    p_date_from: from ?? undefined,
    p_date_to: expandDateToEndOfDay(to) ?? undefined,
    p_models: modelFilterList(filters.platforms) ?? undefined,
    p_regions: filters.regions && filters.regions.length > 0 ? filters.regions : undefined,
    // Topics resolve to prompts before the call, so the functions never have
    // to know that a topic is a set of prompts.
    p_prompt_ids: topicPromptIds ?? promptIds ?? undefined,
  };
}

/**
 * Flatten the platform filter the way the picker sends it.
 *
 * One option can stand for a whole model family (`gpt-5-3-mini,gpt-5-5`), so a
 * single selection may mean several slugs.
 */
function modelFilterList(models: string[] | undefined): string[] | null {
  if (!models || models.length === 0) return null;
  const list = Array.from(
    new Set(
      models.flatMap((model) =>
        model
          .split(',')
          .map((slug) => slug.trim())
          .filter(Boolean),
      ),
    ),
  );
  return list.length > 0 ? list : null;
}

interface DomainAggRow {
  domain: string;
  total_citations: number;
  results_citing: number;
  models: string[] | null;
}

interface UrlAggRow {
  url: string;
  domain: string;
  title: string | null;
  total_citations: number;
  results_citing: number;
  models: string[] | null;
  total_urls: number;
}

/**
 * The Citations overview, aggregated in Postgres (#732).
 *
 * Until phase 2 this paged every answer in the window out to the app tier and
 * expanded `prompt_results.citations` here: 50 sequential requests carrying
 * 65 MB of jsonb on the largest brand, and a hard 50,000-row ceiling that
 * silently truncated it at its 51,679. The citation rows written in phase 1
 * make that an ordinary indexed aggregation.
 *
 * What stays in JavaScript is what the database cannot know: which domains
 * belong to this brand and which to a competitor. That classification depends
 * on the brand's own domain list, and it applies to the ~20,000 aggregated
 * domains rather than to two million citations.
 */
export async function getCitationsOverview(
  brandId: string,
  filters: CitationsFilters,
): Promise<CitationsOverview> {
  const supabase = await createClient();

  const [{ data: brandDomainRows }, { data: competitorRows }, topicPromptIds] = await Promise.all([
    supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabase.from('competitors').select('domain').eq('brand_id', brandId),
    resolveTopicPromptIds(supabase, filters),
  ]);

  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const classifyCtx = { brandDomains, competitorDomains };

  const args = overviewArgs(brandId, filters, topicPromptIds);

  // In parallel: the three are independent, and the slowest decides the wait.
  const [domainRes, urlRes, statsRes] = await Promise.all([
    supabase.rpc('citations_domains', args),
    supabase.rpc('citations_urls', { ...args, p_limit: CITATIONS_URL_LIMIT }),
    supabase.rpc('citations_window_stats', args),
  ]);

  if (domainRes.error) throw new Error(domainRes.error.message);
  if (urlRes.error) throw new Error(urlRes.error.message);
  if (statsRes.error) throw new Error(statsRes.error.message);

  const stats = (statsRes.data as { results: number; regions: string[] | null }[] | null)?.[0];
  const totalResults = Number(stats?.results ?? 0);

  const classifyCache = new Map<string, SourceCategory>();
  const categoryOf = (domain: string): SourceCategory => {
    let category = classifyCache.get(domain);
    if (category === undefined) {
      category = classifyDomain(domain, classifyCtx);
      classifyCache.set(domain, category);
    }
    return category;
  };

  // Scope filters apply to aggregated rows rather than to citations, which is
  // exact: a domain's category is a property of the domain, so filtering after
  // the rollup keeps every count identical to filtering before it.
  const keep = (category: SourceCategory) => {
    if (filters.excludeOwnDomain && category === 'you') return false;
    if (filters.competitorOnly && category !== 'competitor') return false;
    if (filters.ownOnly && category !== 'you') return false;
    return true;
  };

  const usagePct = (resultsCiting: number) =>
    totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0;

  const rows: CitationDomainRow[] = ((domainRes.data as DomainAggRow[] | null) ?? [])
    .map((row) => ({ row, category: categoryOf(row.domain) }))
    .filter(({ category }) => keep(category))
    .map(({ row, category }) => {
      const resultsCiting = Number(row.results_citing);
      const totalCitations = Number(row.total_citations);
      return {
        domain: row.domain,
        category,
        models: (row.models ?? []).slice().sort(),
        totalCitations,
        avgCitationsPerResult:
          resultsCiting > 0 ? Math.round((totalCitations / resultsCiting) * 10) / 10 : 0,
        resultsCiting,
        usagePct: usagePct(resultsCiting),
        // Computed but never rendered — see CitationDomainRow.
        articleTypes: [],
      };
    });

  const urlRowsRaw = (urlRes.data as UrlAggRow[] | null) ?? [];
  const urlRows: CitationUrlRow[] = urlRowsRaw
    .map((row) => ({ row, category: categoryOf(row.domain) }))
    .filter(({ category }) => keep(category))
    .map(({ row, category }) => {
      const resultsCiting = Number(row.results_citing);
      return {
        url: row.url,
        domain: row.domain,
        category,
        title: row.title ?? '',
        models: (row.models ?? []).slice().sort(),
        totalCitations: Number(row.total_citations),
        resultsCiting,
        usagePct: usagePct(resultsCiting),
        articleType: classifyArticleType(row.url, row.title ?? undefined),
      };
    });

  const citations = rows.reduce((sum, row) => sum + row.totalCitations, 0);

  const categoryCounts = new Map<SourceCategory, number>();
  for (const row of rows) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
  }
  const sourceTypeBreakdown: CitationsSourceBreakdown[] = SOURCE_CATEGORIES.map((category) => {
    const count = categoryCounts.get(category) ?? 0;
    return {
      category,
      count,
      pct: rows.length > 0 ? Math.round((count / rows.length) * 1000) / 10 : 0,
    };
  }).filter((b) => b.count > 0);

  return {
    rows,
    urlRows,
    totals: {
      domains: rows.length,
      // The uncapped count, so the page never implies it has every URL. Falls
      // back to what arrived when the window produced nothing at all.
      urls: Number(urlRowsRaw[0]?.total_urls ?? urlRows.length),
      citations,
      results: totalResults,
      avgCitationsPerResult:
        totalResults > 0 ? Math.round((citations / totalResults) * 10) / 10 : 0,
    },
    sourceTypeBreakdown,
    availableRegions: (stats?.regions ?? []).slice().sort(),
  };
}

/** Topic filter → the prompt ids it covers, or null when no topic is selected. */
async function resolveTopicPromptIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: CitationsFilters,
): Promise<string[] | null> {
  if (!filters.topicIds || filters.topicIds.length === 0) return null;
  const { data } = await supabase.from('prompts').select('id').in('topic_id', filters.topicIds);
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  // An empty result must exclude everything rather than filter nothing.
  return ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
}

// ─── Competitor Gaps (#300) ─────────────────────────────────────────────────

/** A third-party domain that cites competitors but never cites/mentions us. */
export interface CitationGapDomain {
  domain: string;
  category: SourceCategory;
  /** Distinct answers where this domain co-occurs with a competitor and we're absent. */
  competitorAnswers: number;
  /** Competitor display names seen alongside this domain (top few). */
  competitors: string[];
  /** Weighted co-occurrence score (each answer split across its distinct sources). */
  strength: number;
}

/** A domain that feeds a specific competitor's AI visibility. */
export interface CompetitorSourceDomain {
  domain: string;
  category: SourceCategory;
  /** Distinct answers where the competitor is mentioned and this domain is cited. */
  answersFeeding: number;
  /** Whether this domain also appears in any answer where our brand is present. */
  alsoCitesUs: boolean;
  strength: number;
}

export interface CitationGapCompetitor {
  id: string;
  name: string;
}

export interface CitationGaps {
  /** Outreach list: domains citing ≥1 competitor and never citing/mentioning us. */
  gapDomains: CitationGapDomain[];
  /** Per-competitor source map, keyed by competitor id. */
  byCompetitor: Record<string, CompetitorSourceDomain[]>;
  /** Competitors that have ≥1 feeding domain (for the selector). */
  competitors: CitationGapCompetitor[];
  /** Answers in the window where our brand was present. */
  ourAnswerCount: number;
  /** Total answers in the window. */
  totalAnswers: number;
  /** True when our presence is so low the gap list is likely too broad to act on. */
  lowVisibility: boolean;
}

const GAP_MIN_COMPETITOR_ANSWERS = 2;
const GAP_LOW_VISIBILITY_RATIO = 0.1;
const GAP_MAX_ROWS = 100;
const GAP_MAX_COMPETITOR_CHIPS = 6;

/**
 * Compute Competitor Gaps from the same `prompt_results` data the citations
 * overview reads — no LLM/scraper calls, no new writes.
 *
 * For each AI answer we look at response-level co-occurrence: the set of cited
 * domains, whether any competitor was mentioned, and whether we were present
 * (our brand mentioned or one of our domains cited). A "gap" domain cites a
 * competitor in an answer where we're absent and never appears in an answer
 * where we're present. Each co-occurrence is weighted by `1 / distinct sources
 * in the answer`, so a focused 2-source answer counts more than a 20-source one.
 */
export async function getCitationGaps(
  brandId: string,
  filters: CitationsFilters,
): Promise<CitationGaps> {
  const supabase = await createClient();

  const { data: brandDomainRows } = await supabase
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);

  const { data: competitorRows } = await supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);
  const competitorList = (competitorRows ?? []) as Array<{
    id: string;
    name: string;
    domain: string;
  }>;
  const competitorDomains = competitorList.map((c) => normalizeDomain(c.domain)).filter(Boolean);
  const competitorNameById = new Map(
    competitorList.map((c) => [c.id, (c.name || '').trim() || 'Competitor']),
  );

  const classifyCtx = { brandDomains, competitorDomains };

  interface GapResultRow {
    id: string;
    citations: Citation[] | null;
    competitor_mentions: CompetitorMention[] | null;
    mention_count: number | null;
  }

  interface DomainAgg {
    domain: string;
    category: SourceCategory;
    competitorAnswers: Set<string>;
    appearsInOurAnswers: boolean;
    strength: number;
    competitorNames: Set<string>;
  }
  interface CompDomainAgg {
    domain: string;
    category: SourceCategory;
    answersFeeding: Set<string>;
    strength: number;
  }

  const domainMap = new Map<string, DomainAgg>();
  const byCompMap = new Map<string, Map<string, CompDomainAgg>>();
  let ourAnswerCount = 0;
  const domainClassificationCache = new Map<string, SourceCategory>();

  const aggregateAnswer = (r: GapResultRow) => {
    const citations = Array.isArray(r.citations) ? r.citations : [];
    const domainCat = new Map<string, SourceCategory>();

    for (const cite of citations) {
      const host = extractHostname(cite.url);
      if (!host || domainCat.has(host)) continue;

      let category = domainClassificationCache.get(host);

      if (category === undefined) {
        category = classifyDomain(host, classifyCtx);
        domainClassificationCache.set(host, category);
      }

      domainCat.set(host, category);
    }
    // Weight each answer's co-occurrences by 1 / distinct sources so a focused
    // answer counts more per domain than a sprawling multi-source one.
    const weight = domainCat.size > 0 ? 1 / domainCat.size : 0;

    const ourDomainCited = Array.from(domainCat.values()).some((cat) => cat === 'you');
    const wePresent = (r.mention_count ?? 0) > 0 || ourDomainCited;
    if (wePresent) ourAnswerCount += 1;

    const mentions = Array.isArray(r.competitor_mentions) ? r.competitor_mentions : [];
    const mentionedCompetitors = mentions.filter((m) => (m.mention_count ?? 0) > 0);
    const competitorPresent = mentionedCompetitors.length > 0;
    const competitorNamesInAnswer = mentionedCompetitors.map(
      (m) => competitorNameById.get(m.competitor_id) ?? ((m.name || '').trim() || 'Competitor'),
    );

    for (const [domain, category] of domainCat) {
      // Only third-party publications are actionable — skip our and competitor sites.
      if (category === 'you' || category === 'competitor') continue;

      const agg = domainMap.get(domain) ?? {
        domain,
        category,
        competitorAnswers: new Set<string>(),
        appearsInOurAnswers: false,
        strength: 0,
        competitorNames: new Set<string>(),
      };
      if (wePresent) agg.appearsInOurAnswers = true;
      if (competitorPresent && !wePresent) {
        agg.competitorAnswers.add(r.id);
        agg.strength += weight;
        for (const name of competitorNamesInAnswer) agg.competitorNames.add(name);
      }
      domainMap.set(domain, agg);

      if (competitorPresent) {
        for (const m of mentionedCompetitors) {
          let perDomain = byCompMap.get(m.competitor_id);
          if (!perDomain) {
            perDomain = new Map<string, CompDomainAgg>();
            byCompMap.set(m.competitor_id, perDomain);
          }
          const cd = perDomain.get(domain) ?? {
            domain,
            category,
            answersFeeding: new Set<string>(),
            strength: 0,
          };
          cd.answersFeeding.add(r.id);
          cd.strength += weight;
          perDomain.set(domain, cd);
        }
      }
    }
  };

  const totalAnswers = await scanFilteredResults<GapResultRow>(
    supabase,
    brandId,
    filters,
    'id, citations, competitor_mentions, mention_count',
    (batch) => {
      for (const r of batch) aggregateAnswer(r);
    },
  );

  const gapDomains: CitationGapDomain[] = Array.from(domainMap.values())
    .filter((g) => !g.appearsInOurAnswers && g.competitorAnswers.size >= GAP_MIN_COMPETITOR_ANSWERS)
    .map((g) => ({
      domain: g.domain,
      category: g.category,
      competitorAnswers: g.competitorAnswers.size,
      competitors: Array.from(g.competitorNames).sort().slice(0, GAP_MAX_COMPETITOR_CHIPS),
      strength: Math.round(g.strength * 1000) / 1000,
    }))
    .sort((a, b) => b.strength - a.strength || b.competitorAnswers - a.competitorAnswers)
    .slice(0, GAP_MAX_ROWS);

  const byCompetitor: Record<string, CompetitorSourceDomain[]> = {};
  for (const [competitorId, perDomain] of byCompMap) {
    const list = Array.from(perDomain.values())
      .map((cd) => ({
        domain: cd.domain,
        category: cd.category,
        answersFeeding: cd.answersFeeding.size,
        alsoCitesUs: domainMap.get(cd.domain)?.appearsInOurAnswers ?? false,
        strength: Math.round(cd.strength * 1000) / 1000,
      }))
      .sort((a, b) => b.strength - a.strength || b.answersFeeding - a.answersFeeding)
      .slice(0, GAP_MAX_ROWS);
    if (list.length > 0) byCompetitor[competitorId] = list;
  }

  const competitors: CitationGapCompetitor[] = competitorList
    .filter((c) => byCompetitor[c.id]?.length)
    .map((c) => ({ id: c.id, name: competitorNameById.get(c.id) ?? c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lowVisibility =
    totalAnswers > 0 && ourAnswerCount / totalAnswers < GAP_LOW_VISIBILITY_RATIO;

  return { gapDomains, byCompetitor, competitors, ourAnswerCount, totalAnswers, lowVisibility };
}

// ─── Existence check (#485) ───────────────────────────────────────────────────

/**
 * Unfiltered existence check — does this brand have any cited answer at all,
 * ignoring the page's date and filter selection? Lets the Citations page
 * distinguish "no data in this window" from "no data at all".
 *
 * Deliberately not a count (#706). `citations <> '[]'` can't use an index, so
 * an exact count made Postgres read and detoast every citation payload the
 * brand has ever produced — ~1.8s and 780 MB of buffers on a large brand with
 * a warm cache, and past the 8s statement timeout once the nightly run had
 * churned the cache, which failed the whole page load. Only the yes/no answer
 * was ever used. Stopping at the first match answers it in ~0.1ms.
 *
 * The ordering is load-bearing: without it the planner picks a sequential scan
 * over the entire table, which is unbounded for a brand whose answers never
 * cite anything. Ordering by created_at keeps the scan on this brand's rows
 * via idx_prompt_results_brand_created.
 *
 * Note that prompt_results.citation_count is NOT a substitute for the
 * `citations <> '[]'` predicate — it counts something narrower, and disagrees
 * on the overwhelming majority of rows.
 */
export async function brandHasCitations(brandId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('id')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .neq('citations', '[]')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// ─── Per-URL detail (#535) ────────────────────────────────────────────────────

/** One answer citing the URL, for the detail page's "Cited in" list. */
export interface CitationUrlOccurrence {
  resultId: string;
  promptId: string;
  promptText: string;
  platform: string | null;
  modelUsed: string | null;
  region: string | null;
  createdAt: string;
  sentiment: string | null;
  /** Whether the brand was mentioned in the same answer. */
  brandMentioned: boolean;
  /** How many times this URL was cited within this one answer. */
  citationsInAnswer: number;
  /** 1-based order of the URL's first citation in the answer (by start index). */
  rank: number;
  /** Total citations in the answer (the rank's denominator). */
  totalSources: number;
}

/** Prompts that trigger this citation, grouped with counts. */
export interface CitationUrlPromptGroup {
  promptId: string;
  promptText: string;
  answers: number;
  citations: number;
  lastSeen: string;
}

export interface CitationUrlTargetingPrompt {
  promptId: string;
  promptText: string;
  label: string | null;
  citedCount: number;
}

export interface CitationUrlDetail {
  /** The normalized URL the page is keyed by. */
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  articleType: string | null;
  totals: {
    citations: number;
    answers: number;
    prompts: number;
    models: string[];
    firstSeen: string | null;
    lastSeen: string | null;
  };
  /** Newest first. */
  occurrences: CitationUrlOccurrence[];
  promptGroups: CitationUrlPromptGroup[];
  /** Present only when the URL is on one of the brand's own domains. */
  owned: {
    targetingPrompts: CitationUrlTargetingPrompt[];
    traffic: { totalVisits: number; byPlatform: { platform: string; visits: number }[] };
  } | null;
}

/** Escape `\`, `%` and `_` for a PostgREST ilike pattern (mirrors traffic.ts). */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const URL_DETAIL_TRAFFIC_MAX_ROWS = 5000;

/**
 * Everything the per-URL citation detail page needs (#535): a URL-filtered
 * scan of prompt_results plus, for brand-owned URLs, the targeting and
 * traffic bridges. Uses the same scan, filters and URL bucketing as
 * getCitationsOverview so the counts here agree with the overview tables for
 * the same URL, window and filters.
 */
export async function getCitationUrlDetail(
  brandId: string,
  rawUrl: string,
  filters: CitationsFilters,
): Promise<CitationUrlDetail> {
  const supabase = await createClient();
  const targetUrl = normalizeCitationUrl(rawUrl);
  const targetHost = extractHostname(targetUrl) ?? '';
  const targetMatchKey = citationUrlMatchKey(targetUrl);

  // Brand + competitor domains → category (same context as the overview).
  const [{ data: brandDomainRows }, { data: competitorRows }] = await Promise.all([
    supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabase.from('competitors').select('domain').eq('brand_id', brandId),
  ]);
  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const category = targetHost
    ? classifyDomain(targetHost, { brandDomains, competitorDomains })
    : 'other';

  interface DetailResultRow {
    id: string;
    prompt_id: string;
    platform: string | null;
    model_used: string | null;
    region: string | null;
    created_at: string;
    sentiment: string | null;
    mention_count: number | null;
    citations: Citation[] | null;
  }

  interface RawOccurrence extends Omit<CitationUrlOccurrence, 'promptText'> {
    promptText: string | null;
  }

  const occurrences: RawOccurrence[] = [];
  const models = new Set<string>();
  let title = '';
  let totalCitations = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  await scanFilteredResults<DetailResultRow>(
    supabase,
    brandId,
    filters,
    'id, prompt_id, platform, model_used, region, created_at, sentiment, mention_count, citations',
    (batch) => {
      for (const result of batch) {
        const citations = Array.isArray(result.citations) ? result.citations : [];
        if (citations.length === 0) continue;

        // Rank citations by their position in the answer; find ours.
        const ordered = [...citations].sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0));
        let rank = 0;
        let citationsInAnswer = 0;
        for (let i = 0; i < ordered.length; i++) {
          if (normalizeCitationUrl(ordered[i].url) !== targetUrl) continue;
          citationsInAnswer += 1;
          if (rank === 0) rank = i + 1;
          if (!title && ordered[i].title) title = ordered[i].title;
        }
        if (citationsInAnswer === 0) continue;

        totalCitations += citationsInAnswer;
        const modelKey = result.model_used || result.platform || '';
        if (modelKey) models.add(modelKey);
        if (!firstSeen || result.created_at < firstSeen) firstSeen = result.created_at;
        if (!lastSeen || result.created_at > lastSeen) lastSeen = result.created_at;

        occurrences.push({
          resultId: result.id,
          promptId: result.prompt_id,
          promptText: null,
          platform: result.platform,
          modelUsed: result.model_used,
          region: result.region,
          createdAt: result.created_at,
          sentiment: result.sentiment,
          brandMentioned: (result.mention_count ?? 0) > 0,
          citationsInAnswer,
          rank,
          totalSources: citations.length,
        });
      }
    },
  );

  occurrences.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Resolve prompt texts for everything the scan touched.
  const promptIds = Array.from(new Set(occurrences.map((o) => o.promptId)));
  const promptTextById = new Map<string, string>();
  if (promptIds.length > 0) {
    const { data: promptRows, error: promptErr } = await supabase
      .from('prompts')
      .select('id, text')
      .in('id', promptIds);
    if (promptErr) throw new Error(promptErr.message);
    for (const p of (promptRows ?? []) as { id: string; text: string }[]) {
      promptTextById.set(p.id, p.text);
    }
  }
  const withText: CitationUrlOccurrence[] = occurrences.map((o) => ({
    ...o,
    promptText: o.promptText ?? promptTextById.get(o.promptId) ?? '(deleted prompt)',
  }));

  // Prompts breakdown — the queries this page is winning.
  const groupMap = new Map<string, CitationUrlPromptGroup>();
  for (const o of withText) {
    const existing = groupMap.get(o.promptId) ?? {
      promptId: o.promptId,
      promptText: o.promptText,
      answers: 0,
      citations: 0,
      lastSeen: o.createdAt,
    };
    existing.answers += 1;
    existing.citations += o.citationsInAnswer;
    if (o.createdAt > existing.lastSeen) existing.lastSeen = o.createdAt;
    groupMap.set(o.promptId, existing);
  }
  const promptGroups = Array.from(groupMap.values()).sort(
    (a, b) => b.citations - a.citations || b.answers - a.answers,
  );

  // Owned-URL bridges: targeting + AI-referred traffic, brand-domain URLs only.
  let owned: CitationUrlDetail['owned'] = null;
  if (category === 'you' && targetMatchKey) {
    const { from, to } = resolveDateRange(filters);
    const expandedTo = expandDateToEndOfDay(to);

    // (a) Prompts targeting this URL, via the workflow's prompt_target_urls.
    // Scoped to the brand through the prompts → prompt_sets join; matched with
    // the same loose key the cited-stats pipeline uses.
    const targetingPromise = supabase
      .from('prompt_target_urls')
      .select(
        'prompt_id, url, label, cited_count, prompts!inner(text, prompt_sets!inner(brand_id))',
      )
      .eq('prompts.prompt_sets.brand_id', brandId);

    // (b) AI-referred visits to this page. The ilike narrows server-side; the
    // exact match happens on the loose key below.
    const pathForSearch = (() => {
      try {
        return new URL(targetUrl).pathname.replace(/\/+$/, '');
      } catch {
        return '';
      }
    })();
    let trafficQuery = supabase
      .from('ai_traffic_logs')
      .select('url, source_platform, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .range(0, URL_DETAIL_TRAFFIC_MAX_ROWS - 1);
    if (pathForSearch) trafficQuery = trafficQuery.ilike('url', `%${escapeIlike(pathForSearch)}%`);
    if (from) trafficQuery = trafficQuery.gte('created_at', from);
    if (expandedTo) trafficQuery = trafficQuery.lte('created_at', expandedTo);

    const [targetingRes, trafficRes] = await Promise.all([targetingPromise, trafficQuery]);
    if (targetingRes.error) throw new Error(targetingRes.error.message);
    if (trafficRes.error) throw new Error(trafficRes.error.message);

    interface TargetRow {
      prompt_id: string;
      url: string;
      label: string | null;
      cited_count: number;
      prompts: { text: string } | { text: string }[];
    }
    const targetingPrompts: CitationUrlTargetingPrompt[] = [];
    for (const row of (targetingRes.data ?? []) as unknown as TargetRow[]) {
      if (citationUrlMatchKey(row.url) !== targetMatchKey) continue;
      const prompt = Array.isArray(row.prompts) ? row.prompts[0] : row.prompts;
      targetingPrompts.push({
        promptId: row.prompt_id,
        promptText: prompt?.text ?? '(deleted prompt)',
        label: row.label,
        citedCount: row.cited_count,
      });
    }
    targetingPrompts.sort((a, b) => b.citedCount - a.citedCount);

    const visitsByPlatform = new Map<string, number>();
    let totalVisits = 0;
    for (const row of (trafficRes.data ?? []) as {
      url: string;
      source_platform: string | null;
    }[]) {
      if (citationUrlMatchKey(row.url) !== targetMatchKey) continue;
      totalVisits += 1;
      const platform = row.source_platform || 'unknown';
      visitsByPlatform.set(platform, (visitsByPlatform.get(platform) ?? 0) + 1);
    }
    const byPlatform = Array.from(visitsByPlatform.entries())
      .map(([platform, visits]) => ({ platform, visits }))
      .sort((a, b) => b.visits - a.visits);

    owned = { targetingPrompts, traffic: { totalVisits, byPlatform } };
  }

  return {
    url: targetUrl,
    domain: targetHost,
    category,
    title,
    articleType: classifyArticleType(targetUrl, title) ?? null,
    totals: {
      citations: totalCitations,
      answers: withText.length,
      prompts: promptIds.length,
      models: Array.from(models).sort(),
      firstSeen,
      lastSeen,
    },
    occurrences: withText,
    promptGroups,
    owned,
  };
}
