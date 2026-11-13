import { htmlText } from '@/lib/content/page-version';

/** A card shows this many characters of a draft; more is cut with a closing "…". */
export const DRAFT_CARD_TEXT_MAX = 20000;

/** A draft page's text for its approval card: a block a line, no tags, list items marked. */
export function draftCardText(html: string): string {
  const text = html
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>|<\/(p|h[1-6]|li|tr|div|blockquote|ul|ol|table)>/gi, '\n')
    .split('\n')
    .map((line) => htmlText(line))
    .filter(Boolean)
    .join('\n');
  return text.length > DRAFT_CARD_TEXT_MAX ? `${text.slice(0, DRAFT_CARD_TEXT_MAX - 1)}…` : text;
}
