/**
 * What the task writer asks the model for (AC-004), and the shape it must
 * answer in. The rules mirror the quality check (quality.js): the model is
 * told what will be refused, and refused tasks are asked for again with the
 * reasons.
 */

import { z } from 'zod';
import { MAX_TASKS } from './quality.js';

/**
 * Looser than the quality rule on purpose: a schema miss throws and costs a
 * retry for the whole set, while a task that fails the rule is replaced on
 * its own.
 */
export const writtenTaskSchema = z.object({
  title: z.string().min(1).max(200),
  where: z.string().max(300),
  why: z.string().max(600),
  how: z.array(z.string().max(300)).max(8),
  doneWhen: z.string().max(300),
  // A string, not the enum: one unknown type is one refused task (quality.js),
  // not a schema miss that throws the whole answer away.
  type: z.string().max(20),
  effort: z.string().max(40),
  role: z.string().max(60),
  refs: z.array(z.string()).max(8),
});

export const taskWriterSchema = z.object({
  tasks: z.array(writtenTaskSchema).max(MAX_TASKS + 2),
});

const SYSTEM = `You turn an AI-visibility action into a short list of concrete tasks a person can do this week.

Every task answers five questions:
- title (What): an imperative sentence naming its target, e.g. "Add a 2026 comparison table to /blog/best-tools". Never "… for 7 prompts" or "across 3 pages": one task, one target.
- where: the exact page URL, prompt, platform, domain or competitor, from the evidence.
- why: the evidence behind it, with its numbers (positions, dates, visits), from the evidence only.
- how: 2 to 5 short steps, in order.
- doneWhen: a measurable check, e.g. "the citation returns on 2 of 3 platforms within 14 days".
Also: type (content, on_page, technical, outreach, pr or product), effort (e.g. "~2h") and role (e.g. "Content writer").

Rules:
- One task per page or domain. Prefer the targets with the most evidence.
- Do not write analysis tasks (analyze, identify, review, validate, measure, monitor): the product already did that work and shows it to the user.
- refs lists the evidence refs the task rests on (e.g. "page:1", "domain:2"). Use only refs that exist. The title or Where must name the target itself: a page by its URL or path, a domain or competitor by name, a prompt by quoting it.
- Use only facts from the evidence. No placeholders, no generic SEO advice.
- Write in English. At most ${MAX_TASKS} tasks.`;

/**
 * @param {{
 *   action: { name: string, category: string, title?: string },
 *   brand: { name: string, description?: string | null, domains: string[] },
 *   evidence: object,
 * }} input evidence as `evidenceForPrompt` gives it
 */
export function buildTaskWriterPrompt({ action, brand, evidence }) {
  const prompt = [
    `Brand: ${brand.name}${brand.domains.length ? ` (${brand.domains.join(', ')})` : ''}`,
    brand.description ? `About the brand: ${brand.description}` : null,
    `Action: ${action.name} (category: ${action.category})`,
    '',
    'Evidence (JSON):',
    JSON.stringify(evidence),
    '',
    `Write up to ${MAX_TASKS} tasks.`,
  ]
    .filter((line) => line !== null)
    .join('\n');
  return { system: SYSTEM, prompt };
}

/**
 * The second ask: replacements for the tasks the quality rule refused,
 * without repeating the ones kept.
 *
 * @param {{ base: { system: string, prompt: string }, kept: object[],
 *   refused: { task: object, problems: string[] }[], count: number }} input
 */
export function buildRetryPrompt({ base, kept, refused, count }) {
  const prompt = [
    base.prompt,
    '',
    'These tasks are already accepted; do not repeat them:',
    ...kept.map((task) => `- ${task.title}`),
    '',
    'These tasks were refused, with the reasons:',
    ...refused.map(({ task, problems }) => `- "${task.title}": ${problems.join('; ')}`),
    '',
    `Write ${count} replacement task${count === 1 ? '' : 's'} that keep every rule.`,
  ].join('\n');
  return { system: base.system, prompt };
}
