/**
 * The no-JS render check (Site Audit spec §6.3, SA-009): how much of a
 * page's main text is in the HTML an AI bot gets, before any JavaScript
 * runs. AI crawlers such as GPTBot, ClaudeBot and PerplexityBot don't run
 * JavaScript, so text that only appears once it runs is text they never see
 * (spec §3: server-rendered HTML is strong evidence).
 *
 * - The rendered page is the one the audit reads (Scrape.do renders it in a
 *   browser); its main text is the Content Editor's import of it, block by
 *   block (pageProse), so menus and footers don't count.
 * - The HTML before JavaScript is the answer the first AI bot let in got in
 *   the live bot test (audit/bot-access.js): no browser and no extra
 *   request. Its text is read whole, <noscript> included, as a crawler
 *   that doesn't run scripts reads it.
 * - A block of the main text is there when most of its runs of three words
 *   are (NO_JS.blockShare), so a date or a counter written in by a script
 *   doesn't hide a whole paragraph. A block shorter than three words must be
 *   there as written.
 * - The share hidden is the words of the blocks that aren't there, out of
 *   all the main text's words. The thresholds are in NO_JS.
 * - Bot protection's own page, served with a 200 in place of the page, isn't
 *   compared (botProtectionPage): nearly all the main text would read as
 *   JavaScript's.
 */

import * as cheerio from 'cheerio';

export const NO_JS = Object.freeze({
  /** Main-text words the rendered page needs for the check to say anything. */
  minWords: 50,
  /** Share of a block's three-word runs that must be in the HTML for the block to be. */
  blockShare: 0.6,
  /** Hidden share up to which the page passes, and up to which it only warns. */
  passUpTo: 0.1,
  warnUpTo: 0.3,
  /** Blocks named as examples, and the characters each is cut to. */
  examples: 3,
  exampleChars: 100,
  /**
   * A raw page holding under this share of the rendered page's words is
   * much shorter than it (botProtectionPage): a page served whole holds
   * about as many words before JavaScript as after, a challenge page a few
   * dozen against the page's hundreds.
   */
  challengeShare: 0.5,
});

/**
 * Markers of bot protection's challenge or block page itself, in its HTML:
 * not the scripts a vendor adds to every page it serves (Cloudflare's
 * /cdn-cgi/challenge-platform/scripts/), which a real page carries too.
 */
const CHALLENGE_MARKERS = [
  // Cloudflare's challenge ("Just a moment...") and block ("Attention Required!") pages.
  /_cf_chl_opt|\/cdn-cgi\/challenge-platform\/h\/|<title>\s*(?:just a moment|attention required)/i,
  // Imperva (Incapsula), DataDome, HUMAN (PerimeterX), Sucuri, AWS WAF.
  /_incapsula_resource|incapsula incident id|captcha-delivery\.com|px-captcha|_pxcaptcha/i,
  /sucuri_cloudproxy|sucuri website firewall|awswafintegration|\.awswaf\.com/i,
  // Vercel, DDoS-Guard, Akamai.
  /vercel security checkpoint|ddos-guard|errors\.edgesuite\.net/i,
  // What their pages say.
  /verify(?:ing)? (?:that )?you are (?:a )?human|checking your browser|enable javascript and cookies to continue/i,
];

/** Lower case, letters and digits only, one space between words. */
function wordsOf(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** A text's runs of three words. */
function trigrams(words) {
  const runs = [];
  for (let i = 0; i + 2 < words.length; i += 1)
    runs.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return runs;
}

/** Elements that end a run of text: a word never runs on from one into the next. */
const BREAKS = new Set([
  ...['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption'],
  ...['figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li'],
  ...['main', 'nav', 'noscript', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul'],
  ...['button', 'option', 'label', 'title'],
]);
/** Elements a crawler that runs no scripts reads nothing in. */
const NO_TEXT = new Set(['script', 'style', 'template', 'svg']);

/** The words a crawler that doesn't run scripts reads in the HTML: <noscript> in, scripts out. */
export function rawWords(html) {
  const $ = cheerio.load(html ?? '', { scriptingEnabled: false });
  // One walk of the tree, a space at each block's edges: "<h1>Guide</h1><p>Pour"
  // is two runs of text, not "GuidePour".
  const parts = [];
  const stack = [...($.root()[0].children ?? [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node === ' ') {
      parts.push(' ');
      continue;
    }
    if (node.type === 'text') {
      parts.push(node.data);
      continue;
    }
    const name = node.name?.toLowerCase();
    if (!node.children || NO_TEXT.has(name)) continue;
    const edge = BREAKS.has(name);
    if (edge) stack.push(' ');
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
    if (edge) parts.push(' ');
  }
  return wordsOf(parts.join(''));
}

/**
 * Whether the HTML a bot got is bot protection's own page served with a 200
 * (a challenge, a "checking your browser" or a block page) in place of the
 * page. Told by both: it carries a challenge or block page's marker, and it
 * is much shorter than the rendered page (NO_JS.challengeShare). Shortness
 * alone isn't enough: an app's empty shell, filled in by JavaScript, is
 * short too, and that is what the check is for. A marker alone isn't
 * either: a page served whole that names a vendor (a CAPTCHA on its form)
 * is compared.
 *
 * @param {string} rawHtml the HTML the bot got, before JavaScript
 * @param {string} renderedHtml the page as a browser renders it
 */
export function botProtectionPage(rawHtml, renderedHtml) {
  const html = String(rawHtml ?? '');
  if (!CHALLENGE_MARKERS.some((marker) => marker.test(html))) return false;
  return rawWords(html).length < NO_JS.challengeShare * rawWords(renderedHtml).length;
}

/**
 * The main text's blocks compared with the HTML before JavaScript.
 *
 * @param {{ text: string }[]} blocks the rendered page's main-text blocks
 * @param {string} html the page's HTML before JavaScript
 * @returns {{ words: number, hiddenWords: number, hiddenShare: number,
 *   hidden: string[] }} hidden: the first hidden blocks, cut short
 */
export function compareNoJs(blocks, html) {
  const raw = rawWords(html);
  const rawRuns = new Set(trigrams(raw));
  const rawLine = ` ${raw.join(' ')} `;
  let words = 0;
  let hiddenWords = 0;
  const hidden = [];
  for (const block of blocks ?? []) {
    const own = wordsOf(block.text);
    if (own.length === 0) continue;
    words += own.length;
    const runs = trigrams(own);
    const there =
      runs.length === 0
        ? rawLine.includes(` ${own.join(' ')} `)
        : runs.filter((r) => rawRuns.has(r)).length / runs.length >= NO_JS.blockShare;
    if (there) continue;
    hiddenWords += own.length;
    if (hidden.length < NO_JS.examples) {
      const text = block.text.replace(/\s+/g, ' ').trim();
      hidden.push(
        text.length > NO_JS.exampleChars ? `${text.slice(0, NO_JS.exampleChars - 1)}…` : text,
      );
    }
  }
  return {
    words,
    hiddenWords,
    hiddenShare: words === 0 ? 0 : Number((hiddenWords / words).toFixed(2)),
    hidden,
  };
}
