/**
 * Head-to-head's Prompt-by-Prompt list, made findable (UX audit CP-12): a
 * search, a sort (most recent, or the widest gap first), a category
 * filter and pages; and the prompts that repeat another but for letter
 * case, to merge on Prompts.
 */

export const PROMPT_PAGE_SIZE = 20;

export type PromptSort = 'recent' | 'diff';

export interface ListedPrompt {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  latestAt: string;
  avgDiff: number;
}

/** The prompts the search, the category and the sort leave, in order. */
export function listPrompts<T extends ListedPrompt>(
  prompts: readonly T[],
  {
    query = '',
    category = '',
    sort = 'recent',
  }: { query?: string; category?: string; sort?: PromptSort },
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = prompts.filter(
    (prompt) =>
      (!category || prompt.promptCategory === category) &&
      words.every((word) => prompt.promptText.toLowerCase().includes(word)),
  );
  return sort === 'diff'
    ? [...kept].sort((a, b) => a.avgDiff - b.avgDiff || b.latestAt.localeCompare(a.latestAt))
    : [...kept].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

/** The categories the prompts have, each once, by name. */
export function promptCategories(prompts: readonly ListedPrompt[]): string[] {
  return [...new Set(prompts.map((p) => p.promptCategory).filter((c): c is string => !!c))].sort(
    (a, b) => a.localeCompare(b),
  );
}

/** How many prompts repeat another one but for letter case and spaces. */
export function caseRepeats(prompts: readonly ListedPrompt[]): number {
  const seen = new Map<string, number>();
  for (const prompt of prompts) {
    const key = prompt.promptText.trim().replace(/\s+/g, ' ').toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].reduce((sum, count) => sum + (count - 1), 0);
}
