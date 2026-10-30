import { z } from 'zod';
import { sendDraftToCms } from '@/lib/actions/cms-send';
import { updateContentDraft } from '@/lib/actions/content-drafts';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { FIXTURE_IDS, defineTool } from './define-tool';
import { draftTitle } from './targets';

/**
 * Chat's Content Library WRITE rows beyond create_draft (CHAT-20 §9 rows 55,
 * 58): changing a draft, and sending one to the brand's CMS as a draft.
 * Each calls a server action over the editor's own path, as the signed-in
 * member. Both are Admins' and Managers' (DECISIONS T: an Analyst's Chat
 * only creates drafts; the API sends pages for Admins and Managers). Going
 * live in a CMS (publish_cms, an EXECUTE) has no row: no CMS the app sends
 * to is published from it yet.
 */

const ITEM = FIXTURE_IDS.item;

/** The CMSs a page goes to, as the Send dialog offers them (cms-send-client CmsTarget). */
const CMS_TARGETS = ['webflow', 'wordpress', 'framer', 'wix', 'webhook'] as const;
const CMS_NAMES: Record<(typeof CMS_TARGETS)[number], string> = {
  webflow: 'Webflow',
  wordpress: 'WordPress',
  framer: 'Framer',
  wix: 'Wix',
  webhook: 'Webhook',
};

export const CONTENT_TOOLS = [
  defineTool({
    name: 'update_draft',
    class: 'write',
    area: 'content',
    description:
      'Change a draft in the Content Library (its id from list_content_drafts): its title, its page as HTML, or both. History keeps the page before the change. Only what the person asked to change; send the whole page when changing it.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C2',
    labelKey: 'reviseDraft',
    route: '/dashboard/content/library',
    mcpTool: null,
    specRow: '55',
    inputSchema: z
      .object({
        draft_id: contentUuid.describe('The draft, from list_content_drafts.'),
        title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional().describe('Its new title.'),
        body_html: z
          .string()
          .max(MAX_BODY_HTML_LENGTH)
          .optional()
          .describe('The whole page as HTML, changed.'),
      })
      .refine((input) => input.title !== undefined || input.body_html !== undefined, {
        message: 'Change the title, the page, or both.',
      }),
    run: (_ctx, input) =>
      updateContentDraft(input.draft_id, { title: input.title, bodyHtml: input.body_html }),
    target: async (input) => {
      const now = await draftTitle(input.draft_id);
      if (!now) return input.title ? `“${input.title}”` : null;
      return input.title && input.title !== now ? `“${now}” → “${input.title}”` : `“${now}”`;
    },
    fixture: { input: { draft_id: ITEM, title: 'Pricing FAQ for teams' } },
  }),
  defineTool({
    name: 'push_cms_draft',
    class: 'write',
    area: 'content',
    description:
      "Send a Library draft to the brand's connected CMS as a draft there (Webflow, WordPress, Framer, Wix or the brand's webhook): nothing goes live. Its slug and meta are what it kept from its last send, else the page's. Only when the person asked for this page to go to that CMS.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    // A connection, not a plan: the API says when the brand hasn't one (not_connected).
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C1',
    labelKey: 'sendToCms',
    route: '/dashboard/content/library',
    mcpTool: null,
    specRow: '58',
    inputSchema: z.object({
      draft_id: contentUuid.describe('The draft, from list_content_drafts.'),
      destination: z.enum(CMS_TARGETS).describe('The CMS the brand connected.'),
    }),
    run: (_ctx, input) => sendDraftToCms(input.draft_id, input.destination),
    target: async (input) => {
      const title = await draftTitle(input.draft_id);
      return [title ? `“${title}”` : null, `→ ${CMS_NAMES[input.destination]}`]
        .filter(Boolean)
        .join(' ');
    },
    fixture: { input: { draft_id: ITEM, destination: 'webflow' } },
  }),
];
