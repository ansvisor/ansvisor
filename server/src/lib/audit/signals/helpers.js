/**
 * Shared helpers for signal evaluators — JSON-LD extraction, link analysis,
 * and readability math. Kept dependency-free (cheerio + plain JS) so signals
 * stay fast and deterministic.
 */

/**
 * Parse every <script type="application/ld+json"> block and flatten @graph /
 * arrays into a single list of typed nodes. Returns `{ nodes, total, valid }`.
 */
export function jsonLd(ctx) {
  const nodes = [];
  let total = 0;
  let valid = 0;

  ctx.$('script[type="application/ld+json"]').each((_, el) => {
    total += 1;
    const raw = ctx.$(el).text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    valid += 1;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) {
        for (const n of item['@graph']) {
          if (n && typeof n === 'object') nodes.push(n);
        }
      } else {
        nodes.push(item);
      }
    }
  });

  return { nodes, total, valid };
}

/** Normalize a node's @type into a lowercase string array. */
export function typesOf(node) {
  const t = node?.['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t])
    .filter((x) => typeof x === 'string')
    .map((x) => x.toLowerCase());
}

/** Split the page's anchors into internal vs external absolute URLs. */
export function classifyLinks(ctx) {
  const host = (() => {
    try {
      return new URL(ctx.url).host;
    } catch {
      return '';
    }
  })();

  const internal = [];
  const external = [];

  ctx.$('a[href]').each((_, el) => {
    const href = (ctx.$(el).attr('href') || '').trim();
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    ) {
      return;
    }
    try {
      const u = new URL(href, ctx.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (u.host === host) internal.push(u);
      else external.push(u);
    } catch {
      /* ignore malformed hrefs */
    }
  });

  return { internal, external };
}

/** Lowercased content of a <meta> by name or property attribute. */
export function metaContent(ctx, key) {
  const el = ctx.$(`meta[name="${key}"], meta[property="${key}"]`).first();
  const v = el.attr('content');
  return typeof v === 'string' ? v.trim() : null;
}

// --- Readability (Flesch Reading Ease) ---

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

/**
 * Flesch Reading Ease for an English-ish body of text. Returns null when there
 * isn't enough text to score.
 */
export function fleschReadingEase(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 30) return null;
  const sentences = (text.match(/[.!?]+(?:\s|$)/g) || []).length || 1;
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
  return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
}

/** Count occurrences of a list of phrases (case-insensitive) in text. */
export function countPhrases(text, phrases) {
  const lower = text.toLowerCase();
  let count = 0;
  for (const p of phrases) {
    let idx = lower.indexOf(p);
    while (idx !== -1) {
      count += 1;
      idx = lower.indexOf(p, idx + p.length);
    }
  }
  return count;
}
