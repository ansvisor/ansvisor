import { z } from 'zod';
import { PAGE_ROWS, pageMeta, pageOfList, pageWindow, type PageWords } from '@/lib/mcp/list-page';

/**
 * What every list read in the registry shares (the owner's rule, 2026-11-16:
 * Chat reads all that a page shows): its page input, the words its
 * description gives the model about pages, and the page it returns
 * (lib/mcp/list-page.ts). scope.ts treats any read with an `offset` as one.
 */

/** A list read's page: how many it holds and where it starts. */
export const pageInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(PAGE_ROWS)
    .optional()
    .describe(`How many on this page, ${PAGE_ROWS} by default.`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Where this page starts: the last page's next_offset."),
};

/** What every list read's description says of its pages. */
export const PAGED = ` A page at a time, ${PAGE_ROWS} by default, every match counted: total is how many match and note says what this page holds. For a question about all of them, read on with offset next_offset, or say how many you judged.`;

type PageInput = { limit?: number; offset?: number };

/** One page of a list the read returns whole, under `key`. */
export function listPage<T>(list: readonly T[], key: string, input: PageInput, words: PageWords) {
  const { rows, ...meta } = pageOfList(list, input, words);
  return { ...meta, [key]: rows };
}

/** A counted page (a `…PageFor` read) under `key`; null as the read's null. */
export function countedPage<T>(
  page: { rows: T[]; total: number } | null,
  key: string,
  input: PageInput,
  words: PageWords,
) {
  if (!page) return null;
  const { offset } = pageWindow(input);
  return { ...pageMeta(words, page.total, offset, page.rows.length), [key]: page.rows };
}
