/**
 * Content-category signal evaluators — Faz 1 ships the deterministic ones
 * (readability, length, youtube-embed) and, on product pages, the
 * description's opening (#1279). The query-dependent / LLM-judged
 * signals (direct-answer, BLUF, query / sub-query / entity coverage,
 * info-density, mega-page, definitions) land in a later phase that feeds the
 * brand's tracked prompts in as the target query.
 *
 * See structure.js for the evaluator shape.
 */

import { jsonLd, typesOf } from './helpers.js';
import { fleschBand, fleschReadingEase, readingBlocks } from './readability.js';
import { OPENING, checkDescriptionOpening } from '../product-description.js';
import { extractPageContent } from '../../page-content.js';

/** Past this, after its scripts and styles, a page isn't read: its content takes too long to find. */
const MAX_READ_HTML = 2_000_000;
/** What holds no text: most of a page's bytes. */
const NO_TEXT = /<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;

/**
 * Flesch Reading Ease of the page's main content, as the Content Editor
 * imports the page and its Quality reads it (signals/readability.js), so a
 * page scores the same in both. A page whose content can't be found, or has
 * too few words, gets none: its menus and footer aren't its text.
 */
export const readability = {
  key: 'readability',
  evaluate(ctx) {
    const html = (ctx.html ?? '').replace(NO_TEXT, ' ');
    if (html.length > MAX_READ_HTML) {
      return { status: 'na', score: null, evidence: { reason: 'page too large to read' } };
    }
    let content = '';
    try {
      content = extractPageContent(html, ctx.url).html;
    } catch {
      // No content found: no score below.
    }
    const flesch = fleschReadingEase(readingBlocks(content));
    if (flesch === null) {
      return { status: 'na', score: null, evidence: { reason: 'not enough text' } };
    }
    const { status, score } = fleschBand(flesch);
    return { status, score, evidence: { fleschReadingEase: Math.round(flesch) } };
  },
};

export const length = {
  key: 'length',
  evaluate(ctx) {
    const words = ctx.wordCount;
    let status = 'fail';
    let score = 0;
    if (words >= 800 && words <= 3000) {
      status = 'pass';
      score = 1;
    } else if ((words >= 400 && words < 800) || (words > 3000 && words <= 5000)) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { words } };
  },
};

export const youtubeEmbed = {
  key: 'youtube-embed',
  evaluate(ctx) {
    const hasEmbed =
      ctx.$(
        'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtu.be"]',
      ).length > 0;
    return {
      status: hasEmbed ? 'pass' : 'fail',
      score: hasEmbed ? 1 : 0,
      evidence: { youtubeEmbed: hasEmbed },
    };
  },
};

/** A JSON-LD value as plain text: a string, or the name of a node. */
const textOf = (value) =>
  typeof value === 'string' ? value : typeof value?.name === 'string' ? value.name : '';

/**
 * A product page's description opening (#1279): on a page with Product
 * structured data, whether the description's first 40 words or 250
 * characters name the product type and two key attributes. The description
 * is the schema's, else the page's microdata one. Other pages don't count.
 */
export const productDescriptionOpening = {
  key: 'product-description-opening',
  evaluate(ctx) {
    const product = jsonLd(ctx).nodes.find((node) =>
      typesOf(node).some((type) => type === 'product' || type === 'productgroup'),
    );
    if (!product) {
      return { status: 'na', score: null, evidence: { reason: 'not a product page' } };
    }
    const description = (
      textOf(product.description) || ctx.$('[itemprop="description"]').first().text()
    )
      .replace(/<[^>]+>/g, ' ')
      .trim();
    if (!description) {
      return { status: 'na', score: null, evidence: { reason: 'no product description' } };
    }

    const result = checkDescriptionOpening({
      description,
      productName: textOf(product.name),
      brand: textOf(product.brand),
    });
    const typeOk = result.namesType !== false;
    const attributesOk = result.attributes.length >= 2;
    const status = typeOk && attributesOk ? 'pass' : typeOk || attributesOk ? 'warn' : 'fail';
    const last = result.opening.split(' ').slice(-6).join(' ');
    const reason =
      `ChatGPT appears to stop reading a product description after about ${OPENING.words} words ` +
      `or ${OPENING.chars} characters, here at "…${last}". ` +
      `Product type named there: ${result.namesType === null ? 'unknown' : result.namesType ? 'yes' : 'no'}. ` +
      `Key attributes there: ${result.attributes.length ? result.attributes.join(', ') : 'none'}.`;
    return {
      status,
      score: status === 'pass' ? 1 : status === 'warn' ? 0.5 : 0,
      evidence: {
        reason,
        cut: result.cut,
        namesType: result.namesType,
        attributes: result.attributes,
      },
    };
  },
};

export const contentSignals = [readability, length, youtubeEmbed, productDescriptionOpening];
