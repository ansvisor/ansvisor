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
import { classifyArticleType, type ArticleType } from '@/lib/citations/article-type';

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

export async function getCitationsOverview(
  brandId: string,
  filters: CitationsFilters,
): Promise<CitationsOverview> {
  const supabase = await createClient();

  // 1. Load brand's own domains.
  const { data: brandDomainRows } = await supabase
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);

  // 2. Load competitor domains.
  const { data: competitorRows } = await supabase
    .from('competitors')
    .select('domain')
    .eq('brand_id', brandId);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);

  const classifyCtx = { brandDomains, competitorDomains };

  // 3+4. Page through the filtered window (see scanFilteredResults) and
  // aggregate in memory batch by batch.
  interface OverviewResultRow {
    id: string;
    prompt_id: string;
    platform: string | null;
    model_used: string | null;
    region: string | null;
    created_at: string;
    citations: Citation[] | null;
  }
  interface DomainAgg {
    domain: string;
    category: SourceCategory;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
    articleTypeCounts: Map<string, number>;
  }
  interface UrlAgg {
    url: string;
    domain: string;
    category: SourceCategory;
    title: string;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
    articleType: string | null;
  }

  const domainMap = new Map<string, DomainAgg>();
  const urlMap = new Map<string, UrlAgg>();

  const domainClassificationCache = new Map<string, SourceCategory>();
  const articleTypeCache = new Map<string, ArticleType | null>();

  let totalCitations = 0;

  const aggregateResult = (result: OverviewResultRow) => {
    const citations = Array.isArray(result.citations) ? result.citations : [];
    const modelKey = result.model_used || result.platform || '';

    for (const cite of citations) {
      const host = extractHostname(cite.url);
      if (!host) continue;

      let category = domainClassificationCache.get(host);

      if (category === undefined) {
        category = classifyDomain(host, classifyCtx);
        domainClassificationCache.set(host, category);
      }

      if (filters.excludeOwnDomain && category === 'you') continue;
      if (filters.competitorOnly && category !== 'competitor') continue;
      if (filters.ownOnly && category !== 'you') continue;

      totalCitations += 1;

      // Domain aggregation.
      const existingDomain = domainMap.get(host) ?? {
        domain: host,
        category,
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
        articleTypeCounts: new Map<string, number>(),
      };
      existingDomain.totalCitations += 1;
      existingDomain.resultsCiting.add(result.id);
      if (modelKey) existingDomain.models.add(modelKey);
      const articleTypeKey = `${cite.url}\n${cite.title ?? ''}`;

      let articleType = articleTypeCache.get(articleTypeKey);

      if (articleType === undefined) {
        articleType = classifyArticleType(cite.url, cite.title);
        articleTypeCache.set(articleTypeKey, articleType);
      }
      if (articleType) {
        existingDomain.articleTypeCounts.set(
          articleType,
          (existingDomain.articleTypeCounts.get(articleType) ?? 0) + 1,
        );
      }
      domainMap.set(host, existingDomain);

      // URL aggregation (strip query/fragment and trailing slash for dedupe).
      let normalizedUrl = cite.url;
      try {
        const parsed = new URL(cite.url);
        parsed.search = '';
        parsed.hash = '';
        normalizedUrl = parsed.toString().replace(/\/$/, '');
      } catch {
        // leave as-is
      }
      const existingUrl = urlMap.get(normalizedUrl) ?? {
        url: normalizedUrl,
        domain: host,
        category,
        title: cite.title || '',
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
        articleType,
      };
      existingUrl.totalCitations += 1;
      existingUrl.resultsCiting.add(result.id);
      if (modelKey) existingUrl.models.add(modelKey);
      if (!existingUrl.title && cite.title) existingUrl.title = cite.title;
      urlMap.set(normalizedUrl, existingUrl);
    }
  };

  const totalResults = await scanFilteredResults<OverviewResultRow>(
    supabase,
    brandId,
    filters,
    'id, prompt_id, platform, model_used, region, created_at, citations, citation_count',
    (batch) => {
      for (const result of batch) aggregateResult(result);
    },
  );

  // 5. Build output arrays.
  const rowsOut: CitationDomainRow[] = Array.from(domainMap.values())
    .map((agg) => {
      const resultsCiting = agg.resultsCiting.size;
      const articleTypes = Array.from(agg.articleTypeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      return {
        domain: agg.domain,
        category: agg.category,
        models: Array.from(agg.models).sort(),
        totalCitations: agg.totalCitations,
        avgCitationsPerResult:
          resultsCiting > 0 ? Math.round((agg.totalCitations / resultsCiting) * 10) / 10 : 0,
        resultsCiting,
        usagePct: totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0,
        articleTypes,
      };
    })
    .sort((a, b) => b.totalCitations - a.totalCitations);

  const urlRowsOut: CitationUrlRow[] = Array.from(urlMap.values())
    .map((agg) => {
      const resultsCiting = agg.resultsCiting.size;
      return {
        url: agg.url,
        domain: agg.domain,
        category: agg.category,
        title: agg.title,
        models: Array.from(agg.models).sort(),
        totalCitations: agg.totalCitations,
        resultsCiting,
        usagePct: totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0,
        articleType: agg.articleType,
      };
    })
    .sort((a, b) => b.totalCitations - a.totalCitations);

  // 6. Source type breakdown (all categories, even with zero).
  const categoryCounts = new Map<SourceCategory, number>();
  for (const row of rowsOut) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
  }
  const totalDomains = rowsOut.length;
  const sourceTypeBreakdown: CitationsSourceBreakdown[] = SOURCE_CATEGORIES.map((category) => {
    const count = categoryCounts.get(category) ?? 0;
    return {
      category,
      count,
      pct: totalDomains > 0 ? Math.round((count / totalDomains) * 1000) / 10 : 0,
    };
  }).filter((b) => b.count > 0);

  return {
    rows: rowsOut,
    urlRows: urlRowsOut,
    totals: {
      domains: rowsOut.length,
      urls: urlRowsOut.length,
      citations: totalCitations,
      results: totalResults,
      avgCitationsPerResult:
        totalResults > 0 ? Math.round((totalCitations / totalResults) * 10) / 10 : 0,
    },
    sourceTypeBreakdown,
  };
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
