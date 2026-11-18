import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import {
  FANOUT_LIGHT_MAX_DAYS,
  getAiBotsFor,
  getCitationGapsFor,
  getCompetitorHeadToHeadFor,
  getGscPagesFor,
  getQueryFanoutsFor,
  getTopicCompetitorMapFor,
  getTopicsOverviewFor,
  getVisibilityOpportunitiesFor,
} from '@/lib/mcp/visibility-extra-reads';
import { FIXTURE_IDS, defineTool } from './define-tool';
import { PAGED, pageInput } from './list-paging';

/**
 * Chat's reads of what Visibility, Prompts, Competitors and AI Traffic show
 * that no other row reads (the owner's plan "Chat must read everything a
 * page shows", step 6c): the Topics tab, Query Fan-outs for a plain
 * question, a competitor's head-to-head, the Overview's Topics vs
 * competitors map and Opportunities card, Citations › Gaps, AI bots and
 * Search Console pages. Each calls lib/mcp/visibility-extra-reads.ts, which
 * reads what the page reads. Inputs are named as the other reads' (brand_id,
 * date_from, date_to, model, region, topic_id, competitor_id, days), so the
 * server's scope and the page's filters fill them the same way.
 */

const brandId = contentUuid.describe('Brand id, from list_brands.');
const dateFrom = z.string().optional().describe('ISO timestamp (inclusive) lower bound.');
const dateTo = z.string().optional().describe('ISO timestamp (inclusive) upper bound.');
const model = z.string().optional().describe('A model slug, or comma-separated slugs.');
const region = z.string().optional().describe('A region code, e.g. "US" or "TR".');
const topicId = contentUuid.optional().describe('Topic id, from list_topics.');

const BRAND = FIXTURE_IDS.brand;

export const VISIBILITY_EXTRA_READS = [
  defineTool({
    name: 'get_topics_overview',
    class: 'read',
    area: 'topics',
    description: `Prompts › Topics, as the tab shows it: each topic's AI Visibility Score, visible and active prompts, change in points against the period before, mentions, citations, share of voice, top competitor (its share), last run and daily trend (the share of its answers naming the brand), highest AI Visibility Score first; summary has the tab's cards (best, weakest, biggest gain) over every topic. For "how is each topic doing" questions; list_topics has only names.${PAGED}`,
    minRole: 'analyst',
    // As the tab: every engine's answers.
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'topicsOverview',
    route: '/dashboard/prompts/topics',
    mcpTool: null,
    specRow: '24',
    inputSchema: z.object({
      brand_id: brandId,
      date_from: dateFrom,
      date_to: dateTo,
      ...pageInput,
    }),
    run: (ctx, input) =>
      getTopicsOverviewFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'get_query_fanouts',
    class: 'read',
    area: 'prompts',
    description: `Prompts › Query Fan-outs for any question about it: the searches AI engines ran behind the brand's tracked answers, over the tab's last 7 days unless a period is asked (30 at most). view queries (default): each sub-query, most searched first, with the engines that ran it, its answers (times_searched), its prompts and whether it is tracked as a prompt (null: unknown), and each engine's sub-queries; prompts: the By prompt view, each prompt's number of sub-queries, most first, with its most searched ones; gaps: sub-queries whose answers never named the brand, most prompts first. Every engine counts, as on the tab. Read this one for a plain question; get_fanouts and get_fanout_gaps run only within a skill.${PAGED}`,
    minRole: 'analyst',
    // As the tab: every engine that answered.
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'queryFanouts',
    route: '/dashboard/prompts/fan-outs',
    mcpTool: null,
    specRow: '18',
    inputSchema: z.object({
      brand_id: brandId,
      days: z
        .number()
        .int()
        .min(1)
        .max(FANOUT_LIGHT_MAX_DAYS)
        .optional()
        .describe(`Days back, 7 by default, ${FANOUT_LIGHT_MAX_DAYS} at most.`),
      view: z.enum(['queries', 'prompts', 'gaps']).optional(),
      ...pageInput,
    }),
    run: (ctx, input) =>
      getQueryFanoutsFor(ctx, {
        brandId: input.brand_id,
        days: input.days,
        view: input.view,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: BRAND, view: 'queries' } },
  }),
  defineTool({
    name: 'get_competitor_head_to_head',
    class: 'read',
    area: 'competitors',
    description: `Competitors' head-to-head with one competitor, over every tracked answer, as the page shows it: both average visibility scores, overall and by AI platform, and each prompt (per platform, model and region) with both scores and the difference. side losing: where the competitor is ahead, biggest gap first (the Gaps tab); winning: where the brand is ahead (Strengths); all (default): most recently run first. With the competitor's timeline: answers mentioning each, week by week, and its pages' events. For "where do we lose to X" questions, name the prompts. Name the competitor by competitor_id (from list_competitors) or by what the person called it (competitor: its name or domain); one that isn't the brand's is in not_found: say so plainly, never offer another.${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'competitorHeadToHead',
    route: '/dashboard/competitors',
    mcpTool: null,
    specRow: '29',
    inputSchema: z.object({
      brand_id: brandId,
      competitor_id: contentUuid.optional().describe('Competitor id, from list_competitors.'),
      competitor: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe('The competitor as the person named it: its name or its domain.'),
      side: z.enum(['losing', 'winning', 'all']).optional(),
      ...pageInput,
    }),
    run: (ctx, input) =>
      getCompetitorHeadToHeadFor(ctx, {
        brandId: input.brand_id,
        competitorId: input.competitor_id,
        competitor: input.competitor,
        side: input.side,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: BRAND, competitor: 'Acme', side: 'losing' } },
  }),
  defineTool({
    name: 'get_topics_vs_competitors',
    class: 'read',
    area: 'visibility',
    description: `Visibility › Overview's Topics vs competitors map: per topic, the brand's and every competitor's Visibility score, who leads it and the brand's gap to the leader; topics the brand leads first, then those it trails (biggest gap first), then those with too few answers. Over whole days of the period. With the trend chart's markers: the days prompts were added, and the AI visibility goal.${PAGED}`,
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'topicCompetitorMap',
    route: '/dashboard/insights',
    mcpTool: null,
    specRow: '11',
    inputSchema: z.object({
      brand_id: brandId,
      date_from: dateFrom,
      date_to: dateTo,
      model,
      region,
      ...pageInput,
    }),
    run: (ctx, input) =>
      getTopicCompetitorMapFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        model: input.model,
        region: input.region,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'get_visibility_opportunities',
    class: 'read',
    area: 'visibility',
    description: `Visibility › Overview's Opportunities card: what to track next, from the stored prompt suggestions, ranked as the card ranks them (fit × demand × gap): each a topic's suggested prompts together or one prompt, with how many prompts tracking it adds, its monthly AI searches (an AI estimate) and who leads its topic in the period. status says why there are none. Track them with add_prompts.${PAGED}`,
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'visibilityOpportunities',
    route: '/dashboard/insights',
    mcpTool: null,
    specRow: '11',
    inputSchema: z.object({
      brand_id: brandId,
      date_from: dateFrom,
      date_to: dateTo,
      model,
      region,
      ...pageInput,
    }),
    run: (ctx, input) =>
      getVisibilityOpportunitiesFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        model: input.model,
        region: input.region,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'get_citation_gaps',
    class: 'read',
    area: 'citations',
    description: `Citations › Gaps (the Competitor Gaps tab), as it shows them: the domains that cite competitors but not the brand. The Gap list (default): third-party domains cited in at least two answers that name a competitor and not the brand, and in none where the brand appears, strongest first, each with its competitor answers, the competitors named and its source type; 100 at most, as on the tab. With competitor_id (from list_competitors), the By competitor view: the third-party domains cited in answers naming that competitor, and whether each also appears where the brand does. low_visibility: the brand is in under 1 answer in 10, so say the list may be broad. For "which sites cite our competitors but not us"; list_citations has every cited domain.${PAGED}`,
    minRole: 'analyst',
    planGate: { platforms: true },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'citationGaps',
    route: '/dashboard/citations',
    mcpTool: null,
    specRow: '28',
    inputSchema: z.object({
      brand_id: brandId,
      date_from: dateFrom,
      date_to: dateTo,
      model,
      region,
      topic_id: topicId,
      competitor_id: contentUuid.optional().describe('Competitor id, from list_competitors.'),
      ...pageInput,
    }),
    run: (ctx, input) =>
      getCitationGapsFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        model: input.model,
        region: input.region,
        topicId: input.topic_id,
        competitorId: input.competitor_id,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'get_ai_bots',
    class: 'read',
    area: 'ai_traffic',
    description:
      "AI Referral Traffic's AI bots reading the brand's site, from its Cloudflare, Vercel or Fastly connection: verified requests over the period by type (training, search index, user fetch) and by bot, with pages and when each last came; the 50 most read pages (pages_total in all) with each type's last read; and cited pages no search bot read in 30 days. state not_connected or waiting: say what to set up. locked: the plan doesn't include it.",
    minRole: 'analyst',
    // The plan decides at run time, as the page (Starter's report is locked; a Growth trial's isn't).
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'aiBots',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: z.object({ brand_id: brandId, date_from: dateFrom, date_to: dateTo }),
    run: (ctx, input) =>
      getAiBotsFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'get_gsc_pages',
    class: 'read',
    area: 'ai_traffic',
    description:
      "AI Referral Traffic's Search Console pages (Is AI taking Google clicks?): pages whose Google impressions rose 15% or more while their click-through fell 20% or more against the period before, the 50 that lost most clicks first (pages_total in all), over the period's length ending on Google's last reported day; or that Search Console isn't connected. Google reports about two to three days late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gscPages',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: z.object({ brand_id: brandId, date_from: dateFrom, date_to: dateTo }),
    run: (ctx, input) =>
      getGscPagesFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
];
