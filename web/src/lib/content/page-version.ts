import { pageTextLength } from './rules';

/**
 * A page's version as Chat's version card shows it (CHAT-25 §6, mockup
 * #e-chat; W4-12a): its sections, its counts, what changed since the
 * version before, and its first sections as a preview. Read from the
 * draft's HTML (already through the draft allow-list) without a DOM, so the
 * server can read it: headings H2 and H3 open a section, the text up to the
 * next one is its body. Pure.
 */

/** A section of the page: its heading and the text under it. */
export interface PageSection {
  heading: string;
  text: string;
}

/** What a version holds: questions (headings ending "?"), sections and characters. */
export interface PageCounts {
  questions: number;
  sections: number;
  characters: number;
}

/** What changed since the version before. */
export interface PageChanges {
  /** Sections whose text got shorter, with their length before and after. */
  shortened: { heading: string; before: number; after: number }[];
  /** Headings the version before didn't have. */
  added: string[];
  /** Placeholders to fill, [LIKE THIS], each once. */
  placeholders: string[];
}

/** The fewest characters a section loses to count as shortened. */
export const SHORTENED_LEAST = 10;

/** The sections a preview shows, and how long each one's text may be. */
export const PREVIEW_SECTIONS = 2;
export const PREVIEW_TEXT = 160;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

/** HTML's text: no tags, the common entities read, runs of spaces as one. */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#39|[a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADING = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

/** The page's sections in order; text before the first heading isn't one. */
export function pageSections(html: string): PageSection[] {
  const marks = [...html.matchAll(HEADING)];
  return marks.flatMap((mark, i) => {
    const heading = htmlText(mark[2]);
    if (!heading) return [];
    const from = (mark.index ?? 0) + mark[0].length;
    const to = i + 1 < marks.length ? (marks[i + 1].index ?? html.length) : html.length;
    return [{ heading, text: htmlText(html.slice(from, to)) }];
  });
}

/** A version's counts, its characters as the editor counts them. */
export function pageCounts(html: string): PageCounts {
  const sections = pageSections(html);
  return {
    questions: sections.filter((section) => section.heading.endsWith('?')).length,
    sections: sections.length,
    characters: pageTextLength(html),
  };
}

const PLACEHOLDER = /\[([A-Z][A-Z0-9 _-]{1,40})\]/g;

/** The placeholders a page leaves to fill, [LIKE THIS], each once, in order. */
export function pagePlaceholders(html: string): string[] {
  return [...new Set([...htmlText(html).matchAll(PLACEHOLDER)].map((m) => `[${m[1].trim()}]`))];
}

/** A placeholder as a move names it: "[REFUND PERIOD]" → "refund period". */
export function placeholderWords(placeholder: string): string {
  return placeholder
    .replace(/^\[|\]$/g, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** What changed from `before` to `after`: shortened sections, new headings, placeholders. */
export function pageChanges(before: string, after: string): PageChanges {
  const was = new Map(pageSections(before).map((section) => [section.heading, section]));
  const now = pageSections(after);
  return {
    shortened: now.flatMap((section) => {
      const old = was.get(section.heading);
      if (!old || old.text.length - section.text.length < SHORTENED_LEAST) return [];
      return [{ heading: section.heading, before: old.text.length, after: section.text.length }];
    }),
    added: now.filter((section) => !was.has(section.heading)).map((section) => section.heading),
    placeholders: pagePlaceholders(after),
  };
}

/** A section's text cut to fit a preview. */
export function cutSection(section: PageSection): PageSection {
  return {
    heading: section.heading,
    text:
      section.text.length > PREVIEW_TEXT
        ? `${section.text.slice(0, PREVIEW_TEXT - 1).trimEnd()}…`
        : section.text,
  };
}

/** The first sections, each one's text cut to fit a preview. */
export function pagePreview(html: string): PageSection[] {
  return pageSections(html).slice(0, PREVIEW_SECTIONS).map(cutSection);
}
