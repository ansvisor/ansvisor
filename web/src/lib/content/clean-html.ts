import DOMPurify from 'dompurify';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  DEMOTED_HEADINGS,
  JSON_LD_SLOT,
  UNSAFE_TAGS,
  cleanHref,
  extractJsonLd,
  restoreJsonLd,
} from './html-allowlist';

/**
 * Cleans HTML in the browser before the editor takes it (Content Editor
 * CE-005, CE-020): a paste from Word, Google Docs, Notion or a web page, and
 * the HTML view when it switches back. Keeps what html-allowlist.ts allows;
 * the server checks every save again (sanitize-draft-html.ts).
 */

export interface CleanedHtml {
  html: string;
  /** Scripts, iframes, objects… taken out (JSON-LD isn't one). */
  unsafeRemoved: number;
  /** Images left out (a paste), or ones that weren't http(s). */
  imagesRemoved: number;
}

// data-i marks a JSON-LD slot; data-pm-slice is how a copy from the editor
// itself says which lists or quotes it was cut out of.
const ALLOWED_ATTR = [
  ...new Set(Object.values(ALLOWED_ATTRIBUTES).flat()),
  'data-i',
  'data-pm-slice',
];

/**
 * Bold and italic set by style, as Google Docs writes them, become <strong>
 * and <em>, so they outlive the styles. Google Docs also wraps a whole copy
 * in <b style="font-weight:normal">, which isn't bold at all.
 */
function keepStyledEmphasis(root: HTMLElement) {
  for (const b of root.querySelectorAll<HTMLElement>('b[id^="docs-internal-guid"]')) {
    b.replaceWith(...b.childNodes);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
    if (el.tagName === 'B' && /font-weight\s*:\s*(normal|[1-5]00)\b/i.test(el.style.cssText)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const weight = el.style.fontWeight;
    // A heading is bold already; its spans only say so again.
    const bold =
      (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) &&
      !el.closest('h1, h2, h3, h4, h5, h6');
    const italic = el.style.fontStyle === 'italic';
    if (!bold && !italic) continue;
    const inner = document.createElement('span');
    inner.append(...el.childNodes);
    let wrapped: HTMLElement = inner;
    if (italic) {
      const em = document.createElement('em');
      em.append(wrapped);
      wrapped = em;
    }
    if (bold) {
      const strong = document.createElement('strong');
      strong.append(wrapped);
      wrapped = strong;
    }
    el.append(wrapped);
  }
}

function demoteHeadings(root: HTMLElement) {
  for (const tag of DEMOTED_HEADINGS) {
    for (const heading of root.querySelectorAll(tag)) {
      const h3 = document.createElement('h3');
      h3.append(...heading.childNodes);
      heading.replaceWith(h3);
    }
  }
}

export function cleanHtml(input: string, { keepImages }: { keepImages: boolean }): CleanedHtml {
  const { html, blocks } = extractJsonLd(input);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Counted in the whole document: a script before any text parses into <head>.
  const unsafeRemoved = doc.querySelectorAll(UNSAFE_TAGS.join(',')).length;
  keepStyledEmphasis(doc.body);
  demoteHeadings(doc.body);

  // A purifier of its own, so these hooks don't touch other uses of DOMPurify.
  const purify = DOMPurify(window);
  let imagesRemoved = 0;
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = cleanHref(node.getAttribute('href') ?? '');
      if (href) node.setAttribute('href', href);
      else node.removeAttribute('href');
    } else if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!keepImages || !/^https?:\/\//i.test(src)) {
        imagesRemoved += 1;
        node.remove();
      }
    } else if (node.hasAttribute('data-i') && node.tagName.toLowerCase() !== JSON_LD_SLOT) {
      node.removeAttribute('data-i');
    }
  });
  const clean = purify.sanitize(doc.body.innerHTML, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, JSON_LD_SLOT],
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // Links and image addresses are checked by the hook above, more strictly
    // than DOMPurify's own rule (which still stops javascript:).
  });

  return {
    html: restoreJsonLd(clean, blocks).replace(/<p>(\s|&nbsp;|<br>)*<\/p>/g, ''),
    unsafeRemoved,
    imagesRemoved,
  };
}

const BLOCKS = 'h[1-6]|p|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|script';
const BEFORE_OPENING_BLOCK = new RegExp(`><(?=(?:${BLOCKS})\\b)`, 'g');
const AFTER_CLOSING_BLOCK = new RegExp(`(</(?:${BLOCKS})>)(?=<)`, 'g');

/**
 * The HTML view's text: the page's HTML as a draft stores it (without the
 * editor's own table widths and link targets), one block per line, so it
 * reads like source. Inline tags stay on their line.
 */
export function formatHtmlSource(html: string): string {
  return cleanHtml(html, { keepImages: true })
    .html.replace(AFTER_CLOSING_BLOCK, '$1\n')
    .replace(BEFORE_OPENING_BLOCK, '>\n<');
}
