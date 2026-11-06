import { z } from 'zod';
import { MAX_NAME, SKILL_NAME } from '@/lib/chat/skills/format';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { DELIVER_CHOICES, type NewSchedule } from './store';
import { WHEN_MAX_LENGTH } from './when';
import { WHATS_NEW_DIGEST, digestPrompt } from './whats-new-digest';

/**
 * A new job's input, as the create_schedule tool asks for it and as the
 * schedule card's Create schedule sends it (lib/actions/chat-schedules.ts
 * reads it again: a server action can be called with anything).
 */

export const PROMPT_MAX = 2000;

export const scheduleInputSchema = z
  .object({
    brand_id: contentUuid
      .optional()
      .describe(
        "The chat's brand id, from list_brands: the job's brand. Leave out for a job about the whole workspace.",
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe('A short name for the job: "Weekly visibility report".'),
    when: z
      .string()
      .trim()
      .min(1)
      .max(WHEN_MAX_LENGTH)
      .describe(
        'When it runs, as the person said it, in English: "every Monday at 9:00", "1st of every month", "tomorrow at 3pm", "in 7 days", "ready by Friday" (starts now, due then).',
      ),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(PROMPT_MAX)
      .optional()
      .describe('What Chat is asked each run, as the person would type it.'),
    skill: z
      .string()
      .regex(SKILL_NAME)
      .max(MAX_NAME)
      .optional()
      .describe('A skill the job runs, by its name without the slash ("report").'),
    deliver_to: z
      .enum(DELIVER_CHOICES)
      .default('chat')
      .describe(
        'Where results go: chat (the job’s chat and the Inbox), email (to the person), or both.',
      ),
    change_only: z
      .boolean()
      .default(false)
      .describe('Recurring jobs: deliver only when the answer changed since the last run.'),
    whats_new: z
      .boolean()
      .default(false)
      .describe(
        'What\'s new for the person\'s plan instead of a prompt or a skill ("Send me What\'s new every month", "Send me this every month" after What\'s new): leave out prompt, skill and brand_id; when "1st of every month at 9:00" unless they said another time. It uses no AI and sends nothing when nothing is new.',
      ),
  })
  .refine((input) => !!input.prompt || !!input.skill || input.whats_new, {
    message: 'A job asks something: a prompt, a skill, or both.',
  });

export type ScheduleInput = z.output<typeof scheduleInputSchema>;

/**
 * The tool's input as the store reads it. A What's new digest (W4-23) asks
 * no prompt or skill and is about the workspace: its message is the
 * digest's own words.
 */
export const newSchedule = (input: ScheduleInput): NewSchedule =>
  input.whats_new
    ? {
        title: input.title,
        when: input.when,
        prompt: digestPrompt(),
        brandId: null,
        deliver: input.deliver_to,
        changeOnly: false,
        digest: WHATS_NEW_DIGEST,
      }
    : {
        title: input.title,
        when: input.when,
        prompt: input.prompt,
        skill: input.skill,
        brandId: input.brand_id ?? null,
        deliver: input.deliver_to,
        changeOnly: input.change_only,
      };
