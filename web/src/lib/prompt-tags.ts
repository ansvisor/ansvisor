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
