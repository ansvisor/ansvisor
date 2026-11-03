import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { PARTS_TOOL } from '../partial-limit';
import {
  imageCostLine,
  imageModelQuestion,
  imagePrecheck,
  makeChatImages,
} from '../images/chat-images';
import { CHAT_IMAGE_VARIANTS, IMAGE_MODELS } from '../images/models';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * Chat's image rows (CHAT-15 §E, CHAT-20 §9 row 70; W4-08): the image
 * model question's options, then images made with the model the person
 * picked. Making them is a WRITE with a cost card in every mode, which says
 * how many images on which model and their share of the monthly AI limit;
 * Admins and Managers. No app page makes images yet, so the rows call
 * Chat's own image functions (lib/chat/images/chat-images.ts).
 */

const BRAND = FIXTURE_IDS.brand;

const IMAGE_MODEL_IDS = IMAGE_MODELS.map((model) => model.id) as [string, ...string[]];

/** The shapes the image models take (CHAT-15 open question 2: 1K, these ratios). */
export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '4:3', '3:2', '9:16'] as const;

/** The image model question's read: listed with the other reads. */
export const IMAGE_READS = [
  defineTool({
    name: 'list_image_models',
    class: 'read',
    area: 'images',
    description:
      "The image models, for the question asked before the first image of a chat: its question and options (each with how fast it uses the monthly AI limit), the recommended one first, and each model's id.",
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'imageModels',
    route: null,
    mcpTool: null,
    specRow: '70',
    inputSchema: z.object({}),
    run: (ctx) => imageModelQuestion(ctx),
    fixture: { input: {} },
  }),
];

/** Making images: listed after the other changes. */
export const IMAGE_WRITES = [
  defineTool({
    name: 'generate_image',
    class: 'write',
    area: 'images',
    description: `Make images for the brand, ${CHAT_IMAGE_VARIANTS} by default at 1K, and keep them in Files as one set the person picks from. Don't say you can't make images: make them with this tool, keeping Chat's rules. Before the first image of a chat, call list_image_models and ask the person with ask_question, with its question and options as they are; then use the model they picked for every image in the chat, unless they ask for another. Before making more than one image, call ${PARTS_TOOL} with parts = count, unit "images" and image_model = the model's id, and follow it. Write the prompt from the request, the brand's look and the page's topic: what to show and its style, in English; no text in the image unless the person asked for it. Never a real person's likeness, insulting or misleading imagery of a competitor or anyone, or a trademark or logo the brand doesn't own: say so in one line and offer an image that keeps to this. When the model makes no image, say why in one line and offer a rephrased prompt.`,
    // The cost card in every mode, with the images' share of the AI limit (§9 row 70).
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { costCard: true },
    // As a report (§9 row 64): Admins and Managers.
    minRole: 'manager',
    // The AI limit is the budget's check, before and as the images are made.
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C3',
    labelKey: 'makeImages',
    route: '/dashboard/chat/files',
    mcpTool: null,
    specRow: '70',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      model: z.enum(IMAGE_MODEL_IDS).describe('The image model the person picked: its id.'),
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .describe('What the image shows and its style, in English.'),
      count: z
        .number()
        .int()
        .min(1)
        .max(CHAT_IMAGE_VARIANTS)
        .default(CHAT_IMAGE_VARIANTS)
        .describe(`How many images: ${CHAT_IMAGE_VARIANTS} unless the AI limit covers fewer.`),
      aspect_ratio: z.enum(IMAGE_ASPECT_RATIOS).optional().describe('Its shape: 16:9 for a cover.'),
      title: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe('What the images are, for Files: "Cover image · GEO strategies for 2026".'),
    }),
    run: (ctx, input) => makeChatImages(ctx, input),
    precheck: (ctx, input) => imagePrecheck(ctx, input),
    // The card's line: how many images, on which model, and their share of the AI limit.
    target: (input) => imageCostLine(input.brand_id, input.model, input.count),
    // The set, filed as it was made: its card shows the images to pick from.
    deliverable: (input, output) => {
      const made = output as { ok?: unknown; file_id?: unknown; title?: unknown; format?: unknown };
      if (made?.ok !== true || typeof made.file_id !== 'string') return null;
      return {
        title: typeof made.title === 'string' ? made.title : input.title?.trim() || input.model,
        type: 'image',
        formats: typeof made.format === 'string' ? [made.format] : [],
        fileId: made.file_id,
      };
    },
    fixture: {
      input: {
        brand_id: BRAND,
        model: IMAGE_MODELS[0].id,
        prompt: 'Abstract dark cover, soft circles, brand colors, no text',
      },
    },
  }),
];
