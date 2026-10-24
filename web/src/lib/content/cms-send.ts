import type { DraftPage } from '@/lib/actions/content-drafts';
import type { AuthorsRead, ContentAuthor } from '@/lib/content/authors';
import { publishableHtml } from '@/lib/content/clean-html';
import {
  bylineText,
  fragment,
  withByline,
  withoutLeadingH1,
  type PageFields,
} from '@/lib/content/ready-to-publish';

/**
 * Send to CMS (#1331): a Content Editor page as the server takes it
 * (POST /api/content-drafts/send) and sends to the brand's webhook. The HTML
 * is the page ready to paste (CE-057: publishableHtml, placeholders filled),
 * with the brand's byline line and without its H1, which the CMS's own title
 * field carries; slug and meta are filled from the page and what the person
 * changed wins.
 */

export interface CmsPage {
  draftId: string;
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  html: string;
  author: string | null;
  featuredImage: { src: string; alt: string } | null;
}

/** The fields a send fills in, editable in the Send dialog and kept on the draft. */
export interface CmsFields {
  slug: string;
  metaTitle: string;
  metaDescription: string;
}

/** As the server's: letters, digits, '-', '_' and single dots. */
const SLUG_PATTERN = /^(?!.*\.\.)[\p{L}\p{N}._-]+$/u;
export const META_TITLE_MAX = 300;
export const META_DESCRIPTION_MAX = 500;
// The server's other limits, which the page itself fills.
const TITLE_MAX = 300;
const AUTHOR_MAX = 200;
const ALT_MAX = 500;
const IMAGE_SRC_MAX = 2048;

/** A meta title from the page stops about here, at a word, as search results cut it (#1331). */
const META_TITLE_PREFILL = 60;

/**
 * Text up to `max` characters, cut at the last space that fits (any space,
 * a no-break one too), or at `max` with none past half, never inside a
 * character (an emoji); without the punctuation a cut leaves at its end.
 */
function upToWord(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let space = -1;
  for (let i = max; i >= 0; i--) {
    if (/\s/u.test(chars[i])) {
      space = i;
      break;
    }
  }
  const cut = chars.slice(0, space > max / 2 ? space : max).join('');
  return cut.replace(/[\s,:;|–—-]+$/u, '');
}

/**
 * What a send starts with: what the draft keeps, else what the page gives,
 * its meta title cut at a word near 60 characters.
 */
export function cmsFields(fields: PageFields, kept: Partial<CmsFields> | null): CmsFields {
  return {
    slug: kept?.slug || fields.slug,
    metaTitle: kept?.metaTitle || upToWord(fields.metaTitle, META_TITLE_PREFILL),
    metaDescription: kept?.metaDescription || fields.metaDescription,
  };
}

/** Why the fields can't go as they are, or null. */
export function cmsFieldsProblem(
  fields: CmsFields,
): 'slug' | 'metaTitle' | 'metaDescription' | null {
  if (!SLUG_PATTERN.test(fields.slug.trim()) || fields.slug.trim().length > 200) return 'slug';
  if (fields.metaTitle.trim().length > META_TITLE_MAX) return 'metaTitle';
  if (fields.metaDescription.trim().length > META_DESCRIPTION_MAX) return 'metaDescription';
  return null;
}

/**
 * Why the page can't go yet, or null: the CMS needs a title, and a page
 * with no words or image under its H1 has nothing to publish.
 */
export function cmsPageProblem(
  title: string,
  html: string,
): 'noTitle' | 'longTitle' | 'empty' | null {
  if (!title.trim()) return 'noTitle';
  if (title.trim().length > TITLE_MAX) return 'longTitle';
  const body = fragment(withoutLeadingH1(html));
  if (!body.textContent?.trim() && !body.querySelector('img')) return 'empty';
  return null;
}

/** A stored page as the Send dialog takes it, as the editor would give it. */
export interface CmsSource {
  draftId: string;
  title: string;
  /** publishableHtml's, as Copy HTML gives it. */
  html: string;
  sourceUrl: string | null;
  author: ContentAuthor | null;
  /** The team byline; empty while the authors aren't read. */
  teamByline: string;
  /** The byline line the brand puts in the content, or null. */
  byline: string | null;
}

/**
 * A Library row's page for Send to CMS, as the editor gives its own: the
 * stored page made publishable, its author and the brand's byline line in
 * the page's language (its own Language rule, else the brand's; a
 * workspace's My rules for the type aren't read here). `authors` is null
 * while Quality is off, as the editor reads none then.
 */
export function cmsSource({
  page,
  authors,
  brandId,
  brandName,
  brandLanguage,
  teamByline,
}: {
  page: DraftPage;
  authors: AuthorsRead | null;
  brandId: string;
  brandName: string;
  brandLanguage: string | null | undefined;
  teamByline: string;
}): CmsSource {
  const author = authors?.authors.find((a) => a.id === page.authorId) ?? null;
  const inContent = authors?.brands.find((b) => b.id === brandId)?.bylineInContent ?? false;
  return {
    draftId: page.id,
    title: page.title,
    html: publishableHtml(page.bodyHtml),
    sourceUrl: page.sourceUrl,
    author,
    teamByline: authors ? teamByline : '',
    byline: inContent
      ? bylineText(page.language ?? brandLanguage, author?.name ?? null, brandName)
      : null,
  };
}

/** The image's alt text, where the page shows it. */
function altOf(html: string, src: string): string {
  const image = [...fragment(html).querySelectorAll('img')].find(
    (img) => img.getAttribute('src') === src,
  );
  return image?.getAttribute('alt') ?? '';
}

/** The page as it goes to the CMS. `html` is publishableHtml's, its placeholders filled. */
export function cmsPage({
  draftId,
  title,
  html,
  fields,
  page,
  byline,
}: {
  draftId: string;
  title: string;
  html: string;
  fields: CmsFields;
  /** pageFields' read of the page: its author and featured image. */
  page: PageFields;
  /** The byline line the brand puts in the content, or null. */
  byline: string | null;
}): CmsPage {
  const withLine = byline ? withByline(html, byline) : html;
  const src = page.featuredImage;
  const image = src?.startsWith('https://') && src.length <= IMAGE_SRC_MAX ? src : null;
  return {
    draftId,
    title: title.trim(),
    slug: fields.slug.trim(),
    metaTitle: fields.metaTitle.trim(),
    metaDescription: fields.metaDescription.trim(),
    html: withoutLeadingH1(withLine),
    author: page.author.trim().slice(0, AUTHOR_MAX) || null,
    featuredImage: image ? { src: image, alt: altOf(html, image).slice(0, ALT_MAX) } : null,
  };
}
