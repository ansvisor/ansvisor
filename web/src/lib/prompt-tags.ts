/**
 * Custom tags on a prompt (#2151): trim, drop empties and duplicates, cap at
 * 50 characters and 10 tags, mirroring what the edit dialog allows. Lives in
 * its own module because actions/prompt.ts is a "use server" file, which may
 * only export async server actions.
 */
export const MAX_PROMPT_TAGS = 10;
export const MAX_PROMPT_TAG_LENGTH = 50;

export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    if (out.length >= MAX_PROMPT_TAGS) break;
    const tag = raw.trim().slice(0, MAX_PROMPT_TAG_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** A prompt as the bulk tag change sees it. */
export interface PromptTags {
  id: string;
  tags?: string[] | null;
}

/** What one bulk add/remove would do, prompt by prompt. */
export interface BulkTagPlan {
  changes: { promptId: string; tags: string[] }[];
  /** Already had every added tag, or none of the removed ones. */
  unchanged: number;
  /** Skipped: adding would take the prompt past MAX_PROMPT_TAGS. */
  blocked: number;
}

/**
 * Add or remove tags across a selection of prompts (#2378), the same
 * add/remove shape as the bulk location change: a selection can hold prompts
 * carrying different tags, and assigning one list to all of them would erase
 * that without saying so. Pure: the dialog previews with this and the server
 * action saves with it, so both tell the same story.
 */
export function planBulkTagChange(
  prompts: readonly PromptTags[],
  action: 'add' | 'remove',
  tags: readonly string[],
): BulkTagPlan {
  const wanted = normalizeTags([...tags]);
  const plan: BulkTagPlan = { changes: [], unchanged: 0, blocked: 0 };
  if (wanted.length === 0) return plan;
  const removing = new Set(wanted);

  for (const prompt of prompts) {
    const current = normalizeTags(prompt.tags ?? []);
    if (action === 'add') {
      const missing = wanted.filter((tag) => !current.includes(tag));
      if (missing.length === 0) {
        plan.unchanged++;
        continue;
      }
      if (current.length + missing.length > MAX_PROMPT_TAGS) {
        plan.blocked++;
        continue;
      }
      plan.changes.push({ promptId: prompt.id, tags: [...current, ...missing] });
    } else {
      const next = current.filter((tag) => !removing.has(tag));
      if (next.length === current.length) {
        plan.unchanged++;
        continue;
      }
      plan.changes.push({ promptId: prompt.id, tags: next });
    }
  }

  return plan;
}
