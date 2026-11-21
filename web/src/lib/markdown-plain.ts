import { stripEntityMarkup } from '@/lib/entity-markup';

/**
 * An AI answer's Markdown as one line of plain text, for a short passage
 * shown as prose: a report's evidence, an excerpt in a table. Links keep
 * their words, images their alt text; bare addresses, headings, quote and
 * bullet marks, emphasis, code ticks and table rules go; escapes read as the
 * character they escape ("1\." reads "1."). Whitespace is folded to single
 * spaces (UX audit RP-03).
 */
export function markdownToPlainText(markdown: string): string {
  return (
    stripEntityMarkup(markdown)
      // Images and links keep their words.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/[^\s)>\]]+/g, '')
      // Line marks: headings, quotes, bullets, table rules.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      .replace(/^[ \t]*[-*+][ \t]+/gm, '')
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
      .replace(/\|/g, ' ')
      // An escaped character reads as itself; a bare emphasis mark goes.
      .replace(/\\([\\`*_{}[\]()#+\-.!>~])|[*_`]+/g, (_, escaped?: string) => escaped ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
