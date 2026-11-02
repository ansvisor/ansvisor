import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { setChatFollowUp } from '@/lib/actions/chat-follow-ups';
import {
  FOLLOW_UP_MAX_DAYS,
  FOLLOW_UP_MAX_PROMPTS,
  FOLLOW_UP_METRICS,
  checkNewFollowUp,
  followUpDateWords,
  followUpDueAt,
  followUpStep,
  type MadeFollowUp,
  type NewFollowUp,
} from '@/lib/chat/schedule/followup';
import { contentUuid, isHttpUrl } from '@/lib/mcp/content-schemas';
import { FIXTURE_IDS, defineTool, type CardFormValues } from './define-tool';

/**
 * Chat's follow-up check row (CHAT-20 §9 row 79, §13; W3-05): a one-time
 * re-check of a page, an action or prompts on a date, from scheduled
 * tracking data only, at no extra cost. Ask (auto allowed in Full auto),
 * its only value: in Ask me first and Auto a one-click card (Set check /
 * Not now); in Full auto it is set by itself, logged in the Activity log
 * with Undo until it runs. Admins and Managers. At most 3 a run. MCP has no
 * tool for it: Scheduled is a page.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatFollowUps' });

/** The checkpoints the card offers (CHAT-22 §2), and any other day the call asked for. */
const DAY_CHOICES = [7, 14, 30, 90] as const;

const inputSchema = z.object({
  brand_id: contentUuid.describe("Brand id, from list_brands: the chat's brand."),
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe('What is checked, short: "Citations check for /pricing".'),
  days: z
    .number()
    .int()
    .min(1)
    .max(FOLLOW_UP_MAX_DAYS)
    .default(14)
    .describe(
      'How many days from now the check reads the tracking data (7, 14, 30 or 90 usually).',
    ),
  target: z
    .object({
      url: z
        .string()
        .trim()
        .max(2048)
        .refine(isHttpUrl, 'url must be an http(s) address')
        .optional()
        .describe('A page whose citations are checked.'),
      action_id: contentUuid.optional().describe('An Action Center action, from list_actions.'),
      prompt_ids: z
        .array(contentUuid)
        .max(FOLLOW_UP_MAX_PROMPTS)
        .optional()
        .describe('Tracked prompts to re-check, from list_prompts.'),
      platforms: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    })
    .refine((target) => !!target.url || !!target.action_id || !!target.prompt_ids?.length, {
      message: 'A check reads a page, an action or prompts.',
    }),
  metric: z.enum(FOLLOW_UP_METRICS).default('visibility'),
});

type FollowUpInput = z.output<typeof inputSchema>;

const newFollowUp = (input: FollowUpInput): NewFollowUp => ({
  brandId: input.brand_id,
  title: input.title,
  days: input.days,
  target: input.target,
  metric: input.metric,
});

export const FOLLOW_UP_TOOLS = [
  defineTool({
    name: 'set_follow_up_check',
    class: 'write',
    area: 'scheduling',
    description:
      'Set a follow-up check: on a later day Chat re-reads the scheduled tracking data for a page, an Action Center action or prompts, and tells the person what changed, at no extra cost. Offer it after a change the person made or approved (a refreshed page, a fix), at most 3 a run.',
    // Ask in Ask me first and Auto, by itself in Full auto: its only value (CHAT-20 row 79).
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'ask_full_auto',
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'followUpCheck',
    route: null,
    mcpTool: null,
    specRow: '79',
    stepKind: 'schedule',
    inputSchema,
    precheck: async (ctx, input) =>
      checkNewFollowUp(
        { userId: ctx.userId, organizationId: ctx.organizationId ?? '' },
        newFollowUp(input),
      ),
    // Through the person's session, as the app's own changes (lib/actions/chat-follow-ups.ts).
    run: (ctx, input) =>
      setChatFollowUp(newFollowUp(input), {
        timezone: ctx.timezone ?? 'UTC',
        runId: ctx.chat?.runId ?? null,
        via: ctx.chat?.executionMode === 'automated' ? 'full_auto' : 'card',
      }),
    target: (input) => input.title,
    form: {
      fields(input, ctx) {
        const days = [...new Set<number>([...DAY_CHOICES, input.days])].sort((a, b) => a - b);
        const dueAt = followUpDueAt(input.days, ctx.timezone, ctx.now);
        return {
          kind: 'followup',
          submit: t('card.submit'),
          cancel: t('card.notNow'),
          fields: [
            {
              name: 'title',
              kind: 'text',
              label: t('card.title'),
              value: input.title,
              maxLength: 120,
              required: true,
            },
            {
              name: 'days',
              kind: 'choice',
              label: t('card.when'),
              value: String(input.days),
              options: days.map((day) => ({ value: String(day), label: t('card.day', { day }) })),
              hint: followUpDateWords(dueAt, ctx.timezone, ctx.now),
            },
          ],
          notes: [t('card.noCost'), t('card.goesTo')],
        };
      },
      apply(input, values: CardFormValues) {
        const days = typeof values.days === 'string' ? Number(values.days) : input.days;
        return {
          ok: true,
          input: {
            ...input,
            title: typeof values.title === 'string' ? values.title : input.title,
            days,
          },
        };
      },
    },
    doneStep: (_input, output) =>
      output && typeof output === 'object' && (output as { ok?: unknown }).ok === true
        ? followUpStep(output as MadeFollowUp)
        : null,
    fixture: {
      input: {
        brand_id: FIXTURE_IDS.brand,
        title: 'Citations check for /pricing',
        days: 14,
        target: { url: 'https://example.com/pricing' },
      },
    },
  }),
];
