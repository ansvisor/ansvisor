import { z } from 'zod';
import { updateOpportunityStatus } from '@/lib/actions/content';
import { createContentDraft } from '@/lib/actions/content-drafts';
import { dismissSuggestion } from '@/lib/actions/prompt-suggestions';
import { PAGE_TYPES } from '@/lib/content/drafts';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { contentUuid, isHttpUrl } from '@/lib/mcp/content-schemas';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * Chat's first WRITE rows (CHAT-20 §9), enough to try the approval flow.
 * Each one calls the server action the app's own button calls, so a change
 * made through Chat is the change the page makes: as the signed-in member,
 * through their session, with the read-only workspace check those actions
 * already run. They need that session: a run with no request behind it
 * (a schedule, CHAT-12) can't call them as they are.
 *
 * minRole follows the role model of 2026-10-29: daily work (drafts, tasks,
 * audits, reports) is open to every role; settings, deleting, adding prompts
 * and costly work stay with Admins and Managers. Where the server leaves a
 * role out of daily work, excludeRoles says so.
 */

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

export const WRITE_TOOLS = [
  defineTool({
    name: 'create_draft',
    class: 'write',
    area: 'content',
    description:
      "Save a page as a new draft in the brand's Content Library, as New content does: its title, page type, what it starts from (an opportunity, a tracked prompt, a topic, or content to optimize) and, when there is one, its HTML.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // A draft is daily work; every member may already save one (content_drafts: member insert).
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C2',
    labelKey: 'saveDraft',
    route: '/dashboard/content/library',
    mcpTool: 'create_content_draft',
    specRow: '54',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).describe('The page title, its H1.'),
      page_type: z.enum(PAGE_TYPES),
      method: z
        .enum(['create', 'optimize'])
        .default('create')
        .describe('create: a new page; optimize: a new version of the page at source_url.'),
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.enum(['opportunity', 'prompt', 'topic']), id: contentUuid }),
        z.object({ kind: z.literal('content') }),
      ]),
      body_html: z.string().max(MAX_BODY_HTML_LENGTH).optional().describe('The page as HTML.'),
      source_url: z
        .string()
        .trim()
        .max(2048)
        .refine(isHttpUrl, 'source_url must be an http(s) address')
        .optional()
        .describe('For optimize: the live page.'),
    }),
    run: (_ctx, input) =>
      createContentDraft(input.brand_id, {
        method: input.method,
        title: input.title,
        pageType: input.page_type,
        // The model's pick is a guess, as Start's is: the type follows the page (CE-023).
        typePicked: false,
        source: input.source,
        bodyHtml: input.body_html,
        sourceUrl: input.source_url,
      }),
    fixture: {
      input: {
        brand_id: BRAND,
        title: 'Pricing FAQ',
        page_type: 'docs_faq',
        source: { kind: 'opportunity', id: ITEM },
      },
    },
  }),
  defineTool({
    name: 'update_opportunity',
    class: 'write',
    area: 'content',
    description:
      'Mark a content opportunity reviewed, or dismiss it, optionally saying why (not relevant, or the wrong angle).',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // Dismissing is Admin and Manager work, as the server's content routes and RLS have it.
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'content_opportunities', idField: 'opportunity_id' },
    costClass: 'C0',
    labelKey: 'opportunityStatus',
    route: '/dashboard/content',
    mcpTool: 'update_opportunity_status',
    specRow: '49',
    inputSchema: z.object({
      opportunity_id: contentUuid.describe('Opportunity id, from list_content_opportunities.'),
      status: z.enum(['reviewed', 'dismissed']),
      reason: z
        .enum(['not_relevant', 'wrong_angle'])
        .optional()
        .describe('Why it is dismissed; only with dismissed.'),
    }),
    run: (_ctx, input) =>
      updateOpportunityStatus(
        input.opportunity_id,
        input.status,
        input.status === 'dismissed' ? input.reason : undefined,
      ),
    fixture: { input: { opportunity_id: ITEM, status: 'dismissed', reason: 'not_relevant' } },
  }),
  defineTool({
    name: 'dismiss_prompt_suggestion',
    class: 'write',
    area: 'prompts',
    description:
      'Dismiss a pending prompt suggestion so it leaves the suggestion list. Only when the user asked for that suggestion to go.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // Admins, Managers and Analysts, as the server (#1763), MCP (#1762) and RLS allow.
    minRole: 'analyst',
    excludeRoles: ['agency_partner'],
    planGate: null,
    brandOf: { lookup: 'prompt_suggestions', idField: 'suggestion_id' },
    costClass: 'C0',
    labelKey: 'dismissSuggestion',
    route: '/dashboard/prompts/suggestions',
    mcpTool: 'dismiss_prompt_suggestion',
    specRow: '23',
    inputSchema: z.object({
      suggestion_id: contentUuid.describe('Suggestion id, from list_prompt_suggestions.'),
    }),
    run: (_ctx, input) => dismissSuggestion(input.suggestion_id),
    fixture: { input: { suggestion_id: ITEM } },
  }),
];
