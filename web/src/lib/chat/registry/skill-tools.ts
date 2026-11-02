import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { saveChatSkill } from '@/lib/actions/chat-skills';
import { MAX_BYTES, MAX_DESCRIPTION, MAX_NAME, SKILL_NAME } from '../skills/format';
import { readSkillName } from '../skills/skill-name';
import { MAX_TITLE } from '../skills/store';
import { defineTool, type CardFormValues } from './define-tool';

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSkills.card' });

const textOf = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

/**
 * Chat's skill WRITE row (CHAT-20 §9 row 75, CHAT-13 item 12): saving a
 * skill of the person's own, through the server action that checks it
 * (lib/actions/chat-skills.ts, skills/store.ts). Admins and Managers; the
 * plan's My skills limit is checked when it saves ("Limits open"). Its card
 * is the skill's draft (W3-08): name, title, what it does and its steps,
 * each editable, in every mode, so nothing is kept before Save and what is
 * kept is what the person read and changed.
 * Sharing it and adding an imported skill are an Admin's, on the Skills
 * page (W3-07, W3-09), not Chat's.
 */

export const SKILL_TOOLS = [
  defineTool({
    name: 'save_skill',
    class: 'write',
    area: 'skills',
    description:
      'Save how-to instructions the person asked to keep as a skill of their own: a /name, what it does and when to use it, and its steps. It stays private to them until an Admin shares it, and it only shapes how Chat works: it adds no tool and skips no card. Only when the person asks to save or create a skill. When they ask to create one ("Create a skill that…"), ask at most two short questions, only if what it should do is unclear, then call this with a draft: the person edits it on its card before anything is kept. Leave out numbers, customer data and this chat\'s facts.',
    // The skill's draft card (W3-08), in every mode: nothing is kept before Save.
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    minRole: 'manager',
    planGate: null,
    // The workspace's, not a brand's.
    brandOf: null,
    costClass: 'C0',
    labelKey: 'newSkill',
    route: null,
    mcpTool: null,
    specRow: '75',
    inputSchema: z.object({
      name: z
        .string()
        .max(MAX_NAME)
        .regex(SKILL_NAME)
        .describe(
          'Its /command without the slash: lowercase letters, digits and single hyphens ("pricing-faq").',
        ),
      title: z
        .string()
        .trim()
        .min(1)
        .max(MAX_TITLE)
        .optional()
        .describe('A short display title ("Pricing FAQ"); the name with spaces when left out.'),
      description: z
        .string()
        .trim()
        .min(1)
        .max(MAX_DESCRIPTION)
        .describe('What it does and when to use it, in one or two sentences.'),
      instructions: z
        .string()
        .trim()
        .min(1)
        .max(MAX_BYTES)
        .describe('Its steps in Markdown: what to read, what to do, what the result looks like.'),
    }),
    run: (_ctx, input) => saveChatSkill(input),
    form: {
      fields: (input) => ({
        kind: 'skill',
        submit: t('submit'),
        fields: [
          {
            name: 'name',
            kind: 'text',
            label: t('name'),
            value: input.name,
            maxLength: MAX_NAME,
            required: true,
            hint: t('nameHint'),
          },
          {
            name: 'title',
            kind: 'text',
            label: t('title'),
            value: input.title ?? input.name.replace(/-/g, ' '),
            maxLength: MAX_TITLE,
          },
          {
            name: 'description',
            kind: 'textarea',
            label: t('description'),
            value: input.description,
            maxLength: MAX_DESCRIPTION,
            required: true,
          },
          {
            name: 'instructions',
            kind: 'textarea',
            label: t('instructions'),
            value: input.instructions,
            maxLength: MAX_BYTES,
            required: true,
          },
        ],
        notes: [t('private'), t('noTool')],
      }),
      apply(input, values: CardFormValues) {
        const { name, problem } = readSkillName(textOf(values.name, input.name));
        if (problem) return { ok: false, error: t(problem, { name }) };
        const title = textOf(values.title, input.title ?? '').trim();
        return {
          ok: true,
          input: {
            ...input,
            name,
            title: title || undefined,
            description: textOf(values.description, input.description).trim(),
            instructions: textOf(values.instructions, input.instructions).trim(),
          },
        };
      },
    },
    doneStep: (input, output) =>
      output && typeof output === 'object' && (output as { ok?: unknown }).ok === true
        ? { label: t('saved', { name: input.name }), detail: t('savedDetail') }
        : null,
    target: (input) => `/${input.name}`,
    cardDetails: (input) => ({
      items: [
        {
          title: input.title ?? input.name.replace(/-/g, ' '),
          detail: input.description,
          body: input.instructions,
        },
      ],
    }),
    fixture: {
      input: {
        name: 'pricing-faq',
        description: 'Writes a pricing FAQ in our tone. Use it for pricing pages.',
        instructions: 'Read the pricing page first. Answer each question in two sentences.',
      },
    },
  }),
];
