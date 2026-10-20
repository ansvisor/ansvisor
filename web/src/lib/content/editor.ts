/**
 * The content editor's rules that don't need the editor itself (Content
 * Editor, CE-004): the draft's title, the length target the counter shows,
 * and which links the toolbar accepts.
 */

/** How long typing pauses before the draft saves itself. */
export const AUTOSAVE_DELAY_MS = 1500;

/** The largest body a draft saves, in characters of HTML (about 100 pages). */
export const MAX_BODY_HTML_LENGTH = 500_000;

/** content_drafts.title's limit (00203). */
export const MAX_TITLE_LENGTH = 300;

/**
 * The counter's target until the Rules tab (CE-009) lets it be changed: the
 * spec's default Length rule, 3,000 characters, 1,200 for a product page and
 * 800 for a category page.
 */
export function lengthTarget(pageType: string | null): number {
  if (pageType === 'product_page') return 1200;
  if (pageType === 'category_page') return 800;
  return 3000;
}

/** The parts of the editor's JSON (TipTap's getJSON) a title is read from. */
export interface EditorJsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: EditorJsonNode[];
}

function textOf(node: EditorJsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join('');
}

/**
 * A draft is named by its page's H1, as the Library lists it: the first H1,
 * else the first heading, else the start of the first text. Empty while the
 * page is.
 */
export function draftTitleFromDoc(doc: EditorJsonNode): string {
  const blocks = (doc.content ?? []).filter((node) => textOf(node).trim());
  const pick =
    blocks.find((node) => node.type === 'heading' && node.attrs?.level === 1) ??
    blocks.find((node) => node.type === 'heading') ??
    blocks[0];
  if (!pick) return '';
  const text = textOf(pick).replace(/\s+/g, ' ').trim();
  if (pick.type === 'heading' || text.length <= 80) return text.slice(0, MAX_TITLE_LENGTH);
  // A first paragraph as the title: cut at a word, with an ellipsis.
  const cut = text.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 80)}…`;
}

/**
 * A link the toolbar sets: a path on the brand's own site (an internal
 * link), or an http(s) or mailto address, so a pasted "javascript:" never
 * becomes a link. A bare domain gets https://. Null when it isn't a link.
 */
export function safeLinkHref(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  // "//host" (and "/\host", which browsers read the same) is another site's
  // address with no scheme to check.
  if (/^\/[/\\]/.test(value)) return null;
  if (value.startsWith('/')) return value;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === 'mailto:') return url.href;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')) {
      return url.href;
    }
  } catch {
    // Not a URL.
  }
  return null;
}

/** An image the toolbar inserts by address: http(s) only. */
export function safeImageSrc(input: string): string | null {
  const href = safeLinkHref(input);
  return href && /^https?:/.test(href) ? href : null;
}
