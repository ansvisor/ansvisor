import { z } from 'zod';
import { actionRef } from '@/lib/action-center/action-ref';
import { PLAN_CARDS, PLAN_PERIODS } from '@/lib/content/plan';
import { getCatalogSourcesFor, listCatalogProductsFor } from '@/lib/mcp/catalog';
import { getContentImpactFor, getContentSourcesFor } from '@/lib/mcp/content';
import { getContentPlanFor } from '@/lib/mcp/content-plan';
import { contentUuid, impactDays } from '@/lib/mcp/content-schemas';
import {
  NOT_IN_PLAN,
  getContentOpportunityFor,
  getPromptUsageFor,
  getReportFor,
  getSiteAuditQuotaFor,
  listShoppingCards,
  listTopicSuggestionsFor,
} from '@/lib/mcp/data';
import { getActionScorecardFor } from '@/lib/mcp/learning';
import { pageMeta, pageWindow, type PageWords } from '@/lib/mcp/list-page';
import {
  getProductAiSaysFor,
  getShoppingReadinessFor,
  getShoppingShelfFor,
} from '@/lib/mcp/product-visibility';
import { getPromptLocationsFor } from '@/lib/mcp/prompt-locations';
import { listTaskReviewsFor } from '@/lib/mcp/task-reviews';
import { FIXTURE_IDS, defineTool } from './define-tool';
import { PAGED, listPage, pageInput } from './list-paging';

/**
 * Chat's rows for the reads the Ansvisor MCP Server already had and Chat
 * didn't (the owner's plan of 2026-11-16, step 6a: Chat reads all that a
 * page shows). Each calls the MCP tool's own data function, with its plan
 * gate, its role rule and its brand scoping (brandAllowed in the function),
 * so Chat and MCP read the same rows. A list comes a page at a time
 * (list-paging.ts). What only MCP reads, and why, is MCP_ONLY_READS: the
 * parity test (mcp-parity.test.ts) fails on an MCP read with neither.
 */

/** MCP reads Chat leaves out on purpose, each with why. */
export const MCP_ONLY_READS: Readonly<Record<string, string>> = {
  get_content_draft_package:
    "A draft as a CMS-ready package for an outside AI tool's own CMS connector; Chat sends a draft with push_cms_draft and publish_cms instead.",
};

const brandId = contentUuid.describe('Brand id, from list_brands.');
const dateFrom = z.string().optional().describe('ISO timestamp (inclusive) lower bound.');
const dateTo = z.string().optional().describe('ISO timestamp (inclusive) upper bound.');
/** Product Visibility's date filter, in days back: the app sets it, as on any `days` read. */
const shoppingDays = z
  .union([z.literal(7), z.literal(30), z.literal(90)])
  .optional()
  .describe('7, 30 (default, as the page opens) or 90 days back.');
const market = z
  .enum(['us', 'europe'])
  .optional()
  .describe(
    "ChatGPT Shopping's market: us or europe. Defaults to the brand's own, as the page opens on.",
  );
const SHOPPING_PLAN = 'Needs a plan with Product Visibility (Growth and above), as the page.';

/** The page's window as Product Visibility's loaders take it ("30d"). */
const periodOf = (days: number | undefined) =>
  days === undefined ? undefined : (`${days}d` as `${7 | 30 | 90}d`);

/** A shopping card as Chat reads it: no scraper payload, image or internal ids. */
const CARD_FIELDS = [
  'position',
  'product_title',
  'product_brand',
  'price_amount',
  'price_currency',
  'merchant_domain',
  'merchant_url',
  'rating',
  'review_count',
  'matched_brand_role',
  'platform',
  'region',
  'created_at',
  'prompt_result_id',
] as const;

/** Cards on a page of list_shopping_cards: a page of compact cards fits a result whole. */
export const SHOPPING_CARDS_PAGE = 20;

/** The most tasks waiting for review read at once: MCP's own maximum. */
export const TASK_REVIEWS_READ = 200;

type PageInput = { limit?: number; offset?: number };

/** A page an MCP read counts itself (its `total`), with the note every list read gives. */
function countedRead<T extends { total: number }>(
  read: T,
  shown: number,
  input: PageInput,
  words: PageWords,
) {
  return { ...read, ...pageMeta(words, read.total, pageWindow(input).offset, shown) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

export const MCP_WRAPPED_READS = [
  // ─── Action Center ───
  defineTool({
    name: 'get_action_scorecard',
    class: 'read',
    area: 'action_center',
    description:
      'What each kind of Action Center action did at this brand, as Action Center › History\'s Scorecard view shows it: one row per kind (content_opportunity, citation_gap, prompt_improve…) of the brand\'s actions raised since date_from (the app sets the period; all of them for all time), busiest first. Each row: completed and their results (improved, mixed, no_change, declined, not_measurable, pending: not read yet, final: read a last time a month on); success_rate (improved ÷ results with a verdict, 0–100; null below three verdicts, too few to say); median_change_percent (+15 is +15%); dismissed, dismiss_reasons and top_dismiss_reason. For "which kinds of work pay off here?". Never compare brands with it, and never say an action caused a change.',
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'actionScorecard',
    route: '/dashboard/action-center/history',
    mcpTool: 'get_action_scorecard',
    specRow: '42',
    inputSchema: z.object({ brand_id: brandId, date_from: dateFrom }),
    run: (ctx, input) =>
      getActionScorecardFor(ctx, { brandId: input.brand_id, since: input.date_from }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'list_task_reviews',
    class: 'read',
    area: 'action_center',
    description: `The brand's tasks waiting for review, as Action Center's Review page (Needs review) shows them, oldest first: tasks an AI writer gave without the exact page (url), the change, Done when or how it is checked. Each: its action (action_id, code as ${actionRef(12)}), title, missing (the fields to fill), details as written and source (who wrote it). They aren't tasks yet: a person approves or dismisses each on the Review page. Admins and Managers only, as the page.${PAGED}`,
    // As the MCP tool and the Review page (the table's RLS): Admins and Managers.
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'taskReviews',
    route: '/dashboard/action-center/review',
    mcpTool: 'list_task_reviews',
    specRow: '38',
    inputSchema: z.object({ brand_id: brandId, ...pageInput }),
    run: async (ctx, input) => {
      const reviews = await listTaskReviewsFor(ctx, {
        brandId: input.brand_id,
        limit: TASK_REVIEWS_READ,
      });
      return (
        reviews &&
        listPage(reviews, 'reviews', input, {
          what: 'tasks waiting for review',
          order: 'oldest first',
        })
      );
    },
    fixture: { input: { brand_id: BRAND } },
  }),

  // ─── Prompts and topics ───
  defineTool({
    name: 'get_prompt_locations',
    class: 'read',
    area: 'prompts',
    description: `Each tracked prompt in each location side by side, as Prompts › Tracked's Locations view shows it: per prompt and location (a country, a US state such as US-CA, a city such as TR~ISTANBUL) its AI Visibility Score (0–100), mentions, citations, average position and runs; tracked_in (the compared locations it tracks) and visibility_gap (best minus worst location). compared has the locations, each metric's average per location (in their order) and ignored_locations (codes given that name no location); insights the view's cards: the weakest and strongest location, the prompt that differs most, and visibility across all. Compares the locations given (at most 12), else those the prompts track, the most tracked first. Over date_from–date_to (the app sets them).${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'promptLocations',
    route: '/dashboard/prompts/tracked',
    mcpTool: 'get_prompt_locations',
    specRow: '13',
    inputSchema: z.object({
      brand_id: brandId,
      locations: z
        .array(z.string().max(60))
        .max(12)
        .optional()
        .describe(
          'Location codes to compare (DE, US-CA, TR~ISTANBUL…); the most tracked when none.',
        ),
      date_from: dateFrom,
      date_to: dateTo,
      ...pageInput,
    }),
    run: async (ctx, input) => {
      const read = await getPromptLocationsFor(ctx, {
        brandId: input.brand_id,
        locations: input.locations,
        from: input.date_from,
        to: input.date_to,
        ...pageWindow(input),
      });
      if (!read || !Array.isArray(read.prompts)) return read;
      // The prompts are the page; the compared locations stay whole beside it (fit.ts cuts a page's lists).
      const { prompts, locations, ignored_locations, averages, ...view } = read;
      return {
        ...countedRead(view, prompts.length, input, {
          what: 'tracked prompts',
          order: 'newest first',
        }),
        compared: { locations, ignored_locations, averages },
        prompts,
      };
    },
    fixture: { input: { brand_id: BRAND, locations: ['US', 'TR'] } },
  }),
  defineTool({
    name: 'get_prompt_usage',
    class: 'read',
    area: 'prompts',
    description:
      "Tracked-prompt usage against the plan, as Prompts › Tracked's usage cards show it: the plan (its locationLimit), the brand's active, paused and total prompts, and the account's active prompts, brands and locationsUsed. The limit counts prompt locations across every brand of the account: each active prompt uses one per location it targets, a paused one none. Slots left = locationLimit − locationsUsed, never below 0; locationLimit null means unlimited. plan.ended true: the plan has ended, and no prompt can be added until a plan is chosen. For \"how many prompts can we still add?\".",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'promptUsage',
    route: '/dashboard/prompts/tracked',
    mcpTool: 'get_prompt_usage',
    specRow: '13',
    inputSchema: z.object({ brand_id: brandId }),
    run: (ctx, input) => getPromptUsageFor(ctx, input.brand_id),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'list_topic_suggestions',
    class: 'read',
    area: 'topics',
    description: `The brand's pending topic suggestions, as the Topic Suggestions card on Prompts › Topics shows them, newest first: name, reason and when each was generated. AI-written suggestions awaiting a decision: accepted or dismissed ones never appear, and a person accepts or dismisses them on the Topics tab.${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'topicSuggestions',
    route: '/dashboard/prompts/topics',
    mcpTool: 'list_topic_suggestions',
    specRow: '24',
    inputSchema: z.object({ brand_id: brandId, ...pageInput }),
    run: async (ctx, input) => {
      const suggestions = await listTopicSuggestionsFor(ctx, input.brand_id);
      return (
        suggestions &&
        listPage(suggestions, 'suggestions', input, {
          what: 'pending topic suggestions',
          order: 'newest first',
        })
      );
    },
    fixture: { input: { brand_id: BRAND } },
  }),

  // ─── Product Visibility and the catalog ───
  defineTool({
    name: 'get_shopping_shelf',
    class: 'read',
    area: 'product_visibility',
    description: `Product Visibility's Shelf, as the Products page shows it: for each shopping question the brand tracks, on each AI channel, the first 10 products the latest answer put on its shelf, in order (rank, title, price, rating, reviews, merchant; own for the brand's, via the marketplace it was linked through, product_id its catalog product) and products_total; the brand's best place (own_rank, null when it isn't on it) and its last 7 days there (week_own_shelves of week_shelves). Shelves it isn't on come first, then where it ranks lowest; one it isn't on has why_not_you: its catalog product the question asks for most, with its readiness. stats counts the period's product slots and the brand's; catalog_products the live catalog. absent_only keeps the shelves it isn't on. ${SHOPPING_PLAN}${PAGED}`,
    minRole: 'analyst',
    planGate: { feature: 'shopping_analytics' },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'shoppingShelf',
    route: '/dashboard/shopping',
    mcpTool: 'get_shopping_shelf',
    specRow: '33',
    inputSchema: z.object({
      brand_id: brandId,
      days: shoppingDays,
      platform: z
        .string()
        .max(64)
        .optional()
        .describe('One AI channel, e.g. "chatgpt-shopping", "google-aimode", "google-aio".'),
      market,
      absent_only: z
        .boolean()
        .optional()
        .describe("Only the shelves the brand's products aren't on."),
      ...pageInput,
    }),
    run: async (ctx, input) => {
      const read = await getShoppingShelfFor(ctx, {
        brandId: input.brand_id,
        period: periodOf(input.days),
        platform: input.platform,
        market: input.market,
        absentOnly: input.absent_only,
        ...pageWindow(input),
      });
      if (!read || read === NOT_IN_PLAN || !Array.isArray(read.shelves)) return read;
      return countedRead(read, read.shelves.length, input, {
        what: 'shelves',
        order: "those without the brand's products first",
      });
    },
    fixture: { input: { brand_id: BRAND, absent_only: true } },
  }),
  defineTool({
    name: 'get_shopping_readiness',
    class: 'read',
    area: 'product_visibility',
    description: `How ready the brand is for AI shopping, as Product Visibility's Readiness tab checks it: score 0–100 over the checks that can be made (null when its catalog couldn't be read: unread says what). Each check: key (catalog, merchantCenter, googleShopping, openAiIndex and verifiedSeller in the US, firstWords, feedFields, feedLinks, wrongPrice, resellerCheaper, amazonShare), state (pass, warn, fail, or unknown), title and detail as the page writes them, and fix: where it starts (products: the Products tab; settings: Settings › Integrations › Catalog). channels says for each AI channel whether the brand's products are on its shelves (showing), its shelves are read without them (notShowing), or it isn't tracked. ${SHOPPING_PLAN}`,
    minRole: 'analyst',
    planGate: { feature: 'shopping_analytics' },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'shoppingReadiness',
    route: '/dashboard/shopping',
    mcpTool: 'get_shopping_readiness',
    specRow: '33',
    inputSchema: z.object({ brand_id: brandId, days: shoppingDays, market }),
    run: (ctx, input) =>
      getShoppingReadinessFor(ctx, {
        brandId: input.brand_id,
        period: periodOf(input.days),
        market: input.market,
      }),
    fixture: { input: { brand_id: BRAND } },
  }),
  defineTool({
    name: 'get_product_ai_says',
    class: 'read',
    area: 'product_visibility',
    description: `What AI says about one of the brand's catalog products, as its product page in Product Visibility shows it: how many AI answers showed it in the period, up to 5 quotes where they name it (their own words, latest first, with the channel, when and the question) and up to 5 pages they cited most. Quoted, never summed up. product_id from list_catalog_products (a product named by part of its title: its search) or a shelf's product_id. ${SHOPPING_PLAN}`,
    minRole: 'analyst',
    planGate: { feature: 'shopping_analytics' },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'productAiSays',
    route: '/dashboard/shopping/products/[productId]',
    mcpTool: 'get_product_ai_says',
    specRow: '33',
    inputSchema: z.object({
      brand_id: brandId,
      product_id: contentUuid.describe(
        'Catalog product id, from list_catalog_products (by its title: its search).',
      ),
      days: shoppingDays,
    }),
    run: (ctx, input) =>
      getProductAiSaysFor(ctx, {
        brandId: input.brand_id,
        productId: input.product_id,
        period: periodOf(input.days),
      }),
    fixture: { input: { brand_id: BRAND, product_id: ITEM } },
  }),
  defineTool({
    name: 'list_shopping_cards',
    class: 'read',
    area: 'product_visibility',
    description: `The shopping cards behind Product Visibility, newest first, ${SHOPPING_CARDS_PAGE} a page: the cards AI answers showed for the brand's questions, each with its position, product title and brand, price, merchant and its page, rating, reviews, matched_brand_role (own, competitor, or other: an untracked brand), platform, region, when, and prompt_result_id (the answer). Filter by role, platform ("chatgpt-shopping", "google-aimode") or region. Read on with cursor next_cursor (null on the last page); there is no count. For the products on each question's shelf, get_shopping_shelf. ${SHOPPING_PLAN}`,
    minRole: 'analyst',
    planGate: { feature: 'shopping_analytics' },
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'shoppingCards',
    route: '/dashboard/shopping',
    mcpTool: 'list_shopping_cards',
    specRow: '33',
    inputSchema: z.object({
      brand_id: brandId,
      role: z.enum(['own', 'competitor', 'other']).optional(),
      platform: z.string().max(64).optional().describe('One AI channel, e.g. "chatgpt-shopping".'),
      region: z.string().optional().describe('A region code, e.g. "US" or "TR".'),
      cursor: z
        .string()
        .max(500)
        .optional()
        .describe("The next page: the last page's next_cursor."),
    }),
    run: async (ctx, input) => {
      const read = await listShoppingCards(ctx, {
        brandId: input.brand_id,
        role: input.role,
        platform: input.platform,
        region: input.region,
        cursor: input.cursor,
        // A fixed page, keyset-paged on the server: no offset, so no row is skipped or read twice.
        limit: SHOPPING_CARDS_PAGE,
      });
      if (!read || read === NOT_IN_PLAN || !Array.isArray(read.cards)) return read;
      const cards = read.cards.map((card) =>
        Object.fromEntries(CARD_FIELDS.map((field) => [field, card[field] ?? null])),
      );
      const note = read.next_cursor
        ? `${cards.length} cards, newest first. Read the next page with cursor next_cursor, or say how many you judged.`
        : cards.length
          ? `${cards.length} cards, newest first. This is the last page.`
          : 'No shopping cards.';
      return { note, next_cursor: read.next_cursor, cards };
    },
    fixture: { input: { brand_id: BRAND, role: 'competitor' } },
  }),
  defineTool({
    name: 'list_catalog_products',
    class: 'read',
    area: 'product_visibility',
    description: `The brand's live catalog products by title, as Product Visibility's Products tab reads them: title, page, brand, product type, category, lowest price in stock, in stock, GTIN; readiness for AI shopping (score 0–100, missing: the checks it fails, unknown: those that can't be made); Google Merchant Center issues by severity (null without a Merchant Center account); and over 30 days the AI visits its page got, their orders and revenue. A product the person names by part of its title: search first (titles containing it, as written). Readiness, issues, visits and revenue need Product Visibility (Growth and above): without it they are null and the products are listed alone.${PAGED}`,
    minRole: 'analyst',
    // As the MCP tool: the products on every plan, their analytics only with Product Visibility.
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'catalogProducts',
    route: '/dashboard/shopping',
    mcpTool: 'list_catalog_products',
    specRow: '33',
    inputSchema: z.object({
      brand_id: brandId,
      search: z.string().max(200).optional().describe('Only products whose title contains it.'),
      ...pageInput,
    }),
    run: async (ctx, input) => {
      const read = await listCatalogProductsFor(ctx, {
        brandId: input.brand_id,
        search: input.search,
        ...pageWindow(input),
      });
      if (!read || !Array.isArray(read.products)) return read;
      return countedRead(read, read.products.length, input, {
        what: 'catalog products',
        order: 'by title',
      });
    },
    fixture: { input: { brand_id: BRAND, search: 'runner' } },
  }),
  defineTool({
    name: 'get_catalog_sources',
    class: 'read',
    area: 'product_visibility',
    description:
      "Where the brand's product catalog is read from, as Settings › Integrations › Catalog shows it: each source's kind (a feed URL, an upload, a store or a Google Merchant Center account), its address or account, its last sync (when, status: ok, failed, format_error or auth_failed, the error, and what it read: items, skipped and why, products added, changed or removed, past the plan's cap) and how many of its products are in the catalog now. Empty for a brand with no catalog.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'catalogSources',
    route: '/dashboard/settings/integrations',
    mcpTool: 'get_catalog_sources',
    specRow: '33',
    inputSchema: z.object({ brand_id: brandId }),
    run: (ctx, input) => getCatalogSourcesFor(ctx, input.brand_id),
    fixture: { input: { brand_id: BRAND } },
  }),

  // ─── Content ───
  defineTool({
    name: 'get_content_plan',
    class: 'read',
    area: 'content',
    description: `The brand's Content plan, as Content › Plan ranks it: what to write or fix next, by the Priority Score (0–100; score_parts says what it is made of), the ones a person marked a priority first. Each row: action (create a new page, optimize a page losing citations or with an opportunity on it, protect a top page), title, page (null for a new one), page_type, why (competitors cited instead, an opportunity's prompts, a citation drop and its platforms, or a top page's citations and AI visits), opportunity_id, the draft already being written for it, and priority. The rows are the page's list, at most 50 (of card when given: create, optimize, protect or priority); counts has every card's full count and hidden the rows a person hid. Over days 7, 30 or 90 (the app sets it; 30 by default).${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'contentPlan',
    route: '/dashboard/content/plan',
    mcpTool: 'get_content_plan',
    specRow: '48',
    inputSchema: z.object({
      brand_id: brandId,
      days: z
        .union([z.literal(PLAN_PERIODS[0]), z.literal(PLAN_PERIODS[1]), z.literal(PLAN_PERIODS[2])])
        .optional()
        .describe('The period the plan reads: 7, 30 (default) or 90 days.'),
      card: z
        .enum(PLAN_CARDS)
        .optional()
        .describe('Only this card: create, optimize, protect or priority.'),
      ...pageInput,
    }),
    run: async (ctx, input) => {
      const plan = await getContentPlanFor(ctx, {
        brandId: input.brand_id,
        days: input.days ?? 30,
        card: input.card,
      });
      if (!plan || !Array.isArray(plan.rows)) return plan;
      const { rows, ...rest } = plan;
      return {
        ...rest,
        ...listPage(rows, 'rows', input, {
          what: 'plan rows',
          order: 'priorities, then highest Priority Score first',
        }),
      };
    },
    fixture: { input: { brand_id: BRAND, card: 'optimize' } },
  }),
  defineTool({
    name: 'get_content_opportunity',
    class: 'read',
    area: 'content',
    description:
      "One content opportunity in full, as its card on Content › Opportunities opens it: the AI visibility gap behind it, its intent, the competitors cited instead, its prompt, status, and the content brief when one was generated. volume is its question's estimated AI searches a month, with its range, confidence and source: an estimate, quote it as a range; null when the prompt has none. By its id from list_content_opportunities (one named by its title: that read's search first).",
    minRole: 'analyst',
    planGate: null,
    brandOf: { lookup: 'content_opportunities', idField: 'opportunity_id' },
    costClass: 'C1',
    labelKey: 'contentOpportunity',
    route: '/dashboard/content',
    mcpTool: 'get_content_opportunity',
    specRow: '48',
    inputSchema: z.object({
      opportunity_id: contentUuid.describe(
        'Opportunity id, from list_content_opportunities (by its title: its search input).',
      ),
    }),
    run: (ctx, input) => getContentOpportunityFor(ctx, input.opportunity_id),
    fixture: { input: { opportunity_id: ITEM } },
  }),
  defineTool({
    name: 'get_content_impact',
    class: 'read',
    area: 'content',
    description:
      "What a draft's live page earns, as the Content Editor's Live page tab reads it: citations in AI answers, AI visits, Google clicks and the prompts citing it, against the period before, over days 7, 30, 90 or 365 (the app sets it). Only for a draft of a live page (published, or optimizing a live page): one with no address yet says so (no_page). Draft id from list_drafts (by its title: its search).",
    minRole: 'analyst',
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C1',
    labelKey: 'contentImpact',
    route: '/dashboard/content/editor',
    mcpTool: 'get_content_impact',
    specRow: '53',
    inputSchema: z.object({
      draft_id: contentUuid.describe(
        'Draft id, from list_drafts (by its title: its search input).',
      ),
      days: impactDays,
    }),
    run: async (ctx, input) => {
      const impact = await getContentImpactFor(ctx, input.draft_id, input.days);
      return impact === 'no_page'
        ? {
            code: 'no_page',
            note: 'This draft has no live address yet: it is measured once it is published, or when it optimizes a live page.',
          }
        : impact;
    },
    fixture: { input: { draft_id: ITEM, days: 30 } },
  }),
  defineTool({
    name: 'get_content_sources',
    class: 'read',
    area: 'content',
    description:
      "The brand's data a draft draws on over the last 30 days, as the Content Editor's Sources tab shows it: its prompts (in the draft, or citing its page) with their answers and mentions, the AI searches (fanouts) run for them, the pages AI cites (citedPages), Search Console queries (gscQueries), the brand's and competitors' domains, and the person's choices (a source left out, or added by hand). Draft id from list_drafts (by its title: its search).",
    minRole: 'analyst',
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C1',
    labelKey: 'contentSources',
    route: '/dashboard/content/editor',
    mcpTool: 'get_content_sources',
    specRow: '53',
    inputSchema: z.object({
      draft_id: contentUuid.describe(
        'Draft id, from list_drafts (by its title: its search input).',
      ),
    }),
    run: async (ctx, input) => {
      const read = await getContentSourcesFor(ctx, input.draft_id);
      if (!read || !isRecord(read.sources)) return read;
      // Each list on its own, so a long one is cut alone (fit.ts) and the rest stay whole.
      return { ...read.sources, choices: read.choices };
    },
    fixture: { input: { draft_id: ITEM } },
  }),

  // ─── Reports and Site Audit ───
  defineTool({
    name: 'get_report',
    class: 'read',
    area: 'reports',
    description:
      "One saved report's content, as its page in Reports shows it: its title, template, period and every section saved with it (the summary, visibility, best and worst prompts, mention and citation evidence, fan-outs, topics, AI traffic, share of voice, competitors, Site Audit…); missingSections lists the sections that couldn't be gathered. A snapshot of its period, never regenerated: say its dates. By its id from get_reports (a report named by its title: that read's search first).",
    minRole: 'analyst',
    planGate: null,
    brandOf: { lookup: 'reports', idField: 'report_id' },
    costClass: 'C1',
    labelKey: 'report',
    route: '/dashboard/reports',
    mcpTool: 'get_report',
    specRow: '63',
    inputSchema: z.object({
      report_id: contentUuid.describe(
        'Saved report id, from get_reports (by its title: its search input).',
      ),
    }),
    run: async (ctx, input) => {
      const report = await getReportFor(ctx, input.report_id);
      if (!report || !isRecord(report.payload)) return report;
      // Its sections at the top, so a long one is cut alone (fit.ts), never the report as text.
      const { payload, ...meta } = report;
      return { ...payload, ...meta };
    },
    fixture: { input: { report_id: ITEM } },
  }),
  defineTool({
    name: 'get_site_audit_quota',
    class: 'read',
    area: 'site_audit',
    description:
      "The workspace's Site Audit audits this month, as Site Audit counts them: used, limit and remaining (limit -1: unlimited). Reading it uses none. Read it before suggesting audits, or when the person asks how many are left.",
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'siteAuditQuota',
    route: '/dashboard/audit',
    mcpTool: 'get_site_audit_quota',
    specRow: '36',
    inputSchema: z.object({}),
    run: (ctx) => getSiteAuditQuotaFor(ctx),
    fixture: { input: {} },
  }),
];
