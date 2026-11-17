import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import {
  getAiConversionsFor,
  getAiConvertingPagesFor,
  getAiPipelineFor,
  getPromptConversionsFor,
  listAiVisitsFor,
} from '@/lib/mcp/ai-conversions';
import { getGaSummaryFor, getGscQueriesFor, getGscSummaryFor } from '@/lib/mcp/google-reads';
import { getTrackingSetupFor } from '@/lib/mcp/tracking-setup';
import { FIXTURE_IDS, defineTool } from './define-tool';
import { PAGED, pageInput } from './list-paging';

/**
 * Chat's Google reads (CHAT-20 §9 row 35; Chat Wave 1 W1-16), and the Search
 * Console queries the /prompts skill proposes prompts from (AGENTS plan §3
 * #10). Each needs its source connected.
 *
 * Then who and what bring customers from AI visits (the owner's question,
 * 2026-11-16; lib/mcp/ai-conversions.ts): what the brand set up to measure
 * them, conversions from AI visits, AI Traffic's Where AI visitors convert,
 * AI-sourced pipeline and visit log, and the prompts cited on the pages that
 * converted, an association. Each says "not measured", with the step that
 * sets it up, when its source isn't there. The page's own plan gate and
 * roles: every member reads them; the pipeline comes with the plan that has
 * CRM integrations. The MCP Server's tools of the same names read them
 * through the same functions.
 */

const input = z.object({
  brand_id: contentUuid.describe('Brand id, from list_brands.'),
  days: z.number().int().min(1).max(90).optional().describe('Days back, 28 by default.'),
});

/** A period, as AI Traffic reads it: the run's range when none is named. */
const period = z.object({
  brand_id: contentUuid.describe('Brand id, from list_brands.'),
  date_from: z.string().optional().describe('ISO day or timestamp (inclusive) lower bound.'),
  date_to: z.string().optional().describe('ISO day or timestamp (inclusive) upper bound.'),
});
const paged = period.extend(pageInput);
const fixture = { input: { brand_id: FIXTURE_IDS.brand } };
type Period = z.output<typeof period> & { limit?: number; offset?: number };
const args = (input: Period) => ({
  brandId: input.brand_id,
  dateFrom: input.date_from,
  dateTo: input.date_to,
  limit: input.limit,
  offset: input.offset,
});
/** What every read of customers from AI says when its source isn't set up. */
const NOT_MEASURED =
  ' When measured is false, say "Not measured", give its next_step with where, and no number for it: never 0.';

export const AI_TRAFFIC_READS = [
  defineTool({
    name: 'get_gsc_summary',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Search Console clicks over a period, against the period before, or that Search Console isn't connected. Google reports about two to three days late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gscSummary',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input,
    run: (ctx, params) => getGscSummaryFor(ctx, { brandId: params.brand_id, days: params.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_gsc_queries',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Search Console queries: each query's clicks, impressions and average position over the last days Google reported, against the span before, the most seen first, or that Search Console isn't connected. Real searches on Google, for which prompts to track; Google reports about two to three days late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gscQueries',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input.extend({
      limit: z.number().int().min(1).max(50).optional().describe('Queries, 25 by default.'),
    }),
    run: (ctx, params) =>
      getGscQueriesFor(ctx, { brandId: params.brand_id, days: params.days, limit: params.limit }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_ga_summary',
    class: 'read',
    area: 'ai_traffic',
    description:
      "The brand's Google Analytics (GA4) sessions over a period: all, from AI, engaged, key events and revenue, against organic, or that Analytics isn't connected. Analytics reports about a day late.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'gaSummary',
    route: '/dashboard/traffic',
    mcpTool: null,
    specRow: '35',
    inputSchema: input,
    run: (ctx, params) => getGaSummaryFor(ctx, { brandId: params.brand_id, days: params.days }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'get_tracking_setup',
    class: 'read',
    area: 'ai_traffic',
    description:
      "What the brand has set up to measure customers and revenue from AI visits: the tracking snippet, conversions from AI visits and their consent mode, whether conversions arrive (from forms, conversion calls, the Shopify pixel), orders with a value, Google Analytics and what it reports, and HubSpot. Each item has its state and what it measures; one that isn't ok has next_step and where (the app page it is done on). Read it first for any question about customers, sign-ups, forms, orders, subscriptions or revenue from AI, and lead the answer with what is missing (not optional first), in the order given.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'trackingSetup',
    route: '/dashboard/traffic',
    mcpTool: 'get_tracking_setup',
    specRow: '35',
    inputSchema: z.object({ brand_id: contentUuid.describe('Brand id, from list_brands.') }),
    run: (ctx, input) => getTrackingSetupFor(ctx, { brandId: input.brand_id }),
    fixture,
  }),
  defineTool({
    name: 'get_ai_conversions',
    class: 'read',
    area: 'ai_traffic',
    description: `Conversions from AI visits that the tracking snippet counted over a period: in all, by type (signup, demo, order, booking, newsletter, custom; orders' units), revenue per currency (orders and bookings), by the AI assistant that first sent the visitor, by the site's own labels, and by landing page: the page that first AI visit landed on (first touch, within 30 days). Give each currency's value on its own, never added to another's. last_conversion_at null: none has ever arrived.${NOT_MEASURED}${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'aiConversions',
    route: '/dashboard/traffic',
    mcpTool: 'get_ai_conversions',
    specRow: '35',
    inputSchema: paged,
    run: (ctx, input) => getAiConversionsFor(ctx, args(input)),
    fixture,
  }),
  defineTool({
    name: 'get_ai_converting_pages',
    class: 'read',
    area: 'ai_traffic',
    description: `AI Traffic's Where AI visitors convert, from Google Analytics: Top converting pages from AI, ranked as the page ranks them (by revenue when the property reports purchases, else by key events), each with its AI visits, key events, revenue, rate and the assistant whose visitors converted most; on the first page, which topics' answers bring buyers. The rate shows from 30 AI visits (rate_note says why there is none); a period with fewer than 30 AI visits reads the last 30 days, as the page does (widened). Revenue is in the Analytics property's own currency: never add it to another source's.${NOT_MEASURED}${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'aiConvertingPages',
    route: '/dashboard/traffic',
    mcpTool: 'get_ai_converting_pages',
    specRow: '35',
    inputSchema: paged,
    run: (ctx, input) => getAiConvertingPagesFor(ctx, args(input)),
    fixture,
  }),
  defineTool({
    name: 'get_ai_pipeline',
    class: 'read',
    area: 'ai_traffic',
    description: `AI Traffic's AI-sourced pipeline, from HubSpot: the contacts, deals, won revenue and open pipeline that came from AI visits over a period, against the period before, by assistant and by landing page (the top ten), in the HubSpot account's currency. HubSpot's own AI Referrals are apart: never add them to the totals.${NOT_MEASURED}`,
    minRole: 'analyst',
    planGate: { feature: 'crm_integrations' },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'aiPipeline',
    route: '/dashboard/traffic',
    mcpTool: 'get_ai_pipeline',
    specRow: '35',
    inputSchema: period,
    run: (ctx, input) => getAiPipelineFor(ctx, args(input)),
    fixture,
  }),
  defineTool({
    name: 'list_ai_visits',
    class: 'read',
    area: 'ai_traffic',
    description: `AI Traffic's visit log: each visit an AI assistant sent over a period, newest first, with when, its landing page, the assistant, country, language and pageviews. assistant narrows it to one assistant's visits, by the source a row gives (chatgpt.com); search to pages whose address contains the text.${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'aiVisits',
    route: '/dashboard/traffic',
    mcpTool: 'list_ai_visits',
    specRow: '35',
    inputSchema: paged.extend({
      assistant: z.string().max(64).optional().describe("An assistant's source: chatgpt.com."),
      search: z.string().max(200).optional().describe("Text in the page's address."),
    }),
    run: (ctx, input) =>
      listAiVisitsFor(ctx, { ...args(input), assistant: input.assistant, search: input.search }),
    fixture,
  }),
  defineTool({
    name: 'get_prompt_conversions',
    class: 'read',
    area: 'ai_traffic',
    description: `Tracked prompts whose answers cite the brand's pages that converted from AI visits over a period, each with how many answers cite them, on which assistants, and those pages' conversions and revenue per currency (conversions from AI visits, else Google Analytics' key events). An association, never attribution: AI assistants don't pass the question. Give its label with it every time, never say a prompt brought a customer, and never add a page's conversions across prompts.${NOT_MEASURED}${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'promptConversions',
    route: '/dashboard/traffic',
    mcpTool: 'get_prompt_conversions',
    specRow: '35',
    inputSchema: paged,
    run: (ctx, input) => getPromptConversionsFor(ctx, args(input)),
    fixture,
  }),
];
