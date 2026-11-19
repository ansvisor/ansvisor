import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';

/**
 * AI-written text in the reader's language (LOC-010): the rows on screen, by
 * kind and id, translated into `locale` by the API (POST /api/ai-text/
 * translate), which reads the rows itself and keeps each translation for
 * the next viewer. From the browser through the API's same-origin proxy,
 * never a server action: Next runs a page's server actions one at a time, and
 * a translation must never hold up the page's own reads.
 */

/** The kinds of AI-written text the API translates (its TRANSLATABLE). */
export type AiTextKind = 'opportunity' | 'action' | 'audit';

/**
 * The field a Site Audit recommendation's explanation is translated under:
 * its place in the audit's list, in letters (the API's recommendationField).
 */
export function auditRecommendationField(index: number): string {
  let letters = '';
  let n = index;
  do {
    letters = String.fromCharCode(97 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  } while (n > 0);
  return `recommendation_${letters}`;
}

/** The most rows one request asks for (the API's MAX_ROWS). */
export const AI_TEXT_MAX_ROWS = 50;

/** A request that hangs gives up after this: the text stays in English. */
const READ_TIMEOUT_MS = 30_000;

/** Each row's translated fields: { [id]: { [field]: text } }. */
export type AiTextTranslations = Record<string, Record<string, string>>;

/**
 * The rows' fields in `locale`, as far as the API could translate them;
 * a row or field left out stays in English. Throws when it can't be read.
 */
export async function readAiTextTranslations(
  kind: AiTextKind,
  ids: string[],
  locale: string,
): Promise<AiTextTranslations> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${BROWSER_API_BASE_URL}/api/ai-text/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ kind, ids: ids.slice(0, AI_TEXT_MAX_ROWS), locale }),
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const body = (await res.json()) as { texts?: AiTextTranslations };
  return body.texts ?? {};
}
