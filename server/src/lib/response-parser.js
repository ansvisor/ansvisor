/**
 * Parses an AI response to extract brand visibility metrics.
 * Mentions and citations are computed locally; sentiment comes from AI.
 */

/**
 * Strip markdown link URLs so only display text remains.
 * "[label](https://example.com/path)" → "label"
 * Also removes bare URLs (https://...) that aren't inside markdown links.
 */
function stripUrls(text) {
  let cleaned = text.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/[^\s)>\]]+/g, '');
  return cleaned;
}

/**
 * Count case-insensitive occurrences of a term in text.
 */
function countOccurrences(text, term) {
  if (!term) return 0;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
  return (text.match(regex) || []).length;
}

/**
 * Normalized hostname of a URL ("https://www.FOO.com/bar" → "foo.com").
 * Mirrors extractHostname in web/src/lib/citations/classify.ts — keep the two
 * in sync: citation_count must agree with the Citations page's read-time
 * classification, or the same metric shows different numbers per surface.
 */
export function extractHostname(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(String(rawUrl).trim());
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    const match = String(rawUrl).match(/^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/**
 * Count the citations that point at one of the brand's own domains: exact
 * host or subdomain match, same rule as the web classifier's 'you' category.
 * The old substring check (url.includes(domain)) also matched the brand's
 * domain inside another site's path or query string, and disagreed with the
 * Citations page over www/subdomain variants.
 */
export function countOwnDomainCitations(citations, brandDomains) {
  const normalized = (brandDomains || [])
    .map(
      (d) =>
        extractHostname(d) ??
        String(d ?? '')
          .trim()
          .toLowerCase(),
    )
    .filter(Boolean);
  if (normalized.length === 0) return 0;

  let count = 0;
  for (const cite of citations || []) {
    const host = extractHostname(cite?.url || '');
    if (host && normalized.some((d) => host === d || host.endsWith(`.${d}`))) {
      count++;
    }
  }
  return count;
}

/**
 * Count how many times the brand (name or any of its domains) is mentioned
 * in an AI response. URL-stripped to avoid double-counting citations.
 * Used to short-circuit sentiment analysis when the brand isn't mentioned.
 */
export function countBrandMentions(text, brand) {
  const cleanText = stripUrls(text);
  let count = countOccurrences(cleanText, brand.brandName);
  for (const domain of brand.domains) {
    count += countOccurrences(cleanText, domain);
  }
  return count;
}

/**
 * First word-boundary occurrence index of a term (case-insensitive), or -1.
 */
function firstOccurrenceIndex(text, term) {
  if (!term) return -1;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(text);
  return match ? match.index : -1;
}

/**
 * Where the brand lands in the answer's mention order, among the brand and
 * its tracked competitors. Deterministic: earliest word-boundary occurrence
 * of each entity's name/domain in the URL-stripped answer text.
 *
 * @returns {{ mentionPosition: number | null, mentionedEntityCount: number }}
 *   mentionPosition — 1-based rank of the brand's first mention (1 = named
 *   first), null when the brand isn't mentioned at all.
 *   mentionedEntityCount — how many of the tracked entities (brand +
 *   competitors) the answer mentions; 0 marks "computed, nothing found",
 *   while NULL in the database means "not computed yet" (backfill marker).
 */
export function computeMentionPosition(text, brand, competitors = []) {
  const cleanText = stripUrls(text);

  const entityFirstIndex = (names) => {
    let best = -1;
    for (const name of names) {
      const idx = firstOccurrenceIndex(cleanText, name);
      if (idx >= 0 && (best === -1 || idx < best)) best = idx;
    }
    return best;
  };

  const brandIndex = entityFirstIndex([brand.brandName, ...(brand.domains || [])]);
  const competitorIndexes = (competitors || [])
    .map((comp) => entityFirstIndex([comp.name, ...(comp.domain ? [comp.domain] : [])]))
    .filter((idx) => idx >= 0);

  const mentionedEntityCount = competitorIndexes.length + (brandIndex >= 0 ? 1 : 0);
  if (brandIndex < 0) return { mentionPosition: null, mentionedEntityCount };

  const namedBefore = competitorIndexes.filter((idx) => idx < brandIndex).length;
  return { mentionPosition: namedBefore + 1, mentionedEntityCount };
}

/**
 * Parse the AI response and compute visibility metrics for a brand.
 * Sentiment must be provided externally (from AI analysis).
 * @param {{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }> }} response
 * @param {{ brandName: string, domains: string[] }} brand
 * @param {'positive'|'neutral'|'negative'} sentiment - AI-analyzed sentiment
 * @param {Array<{ id: string, name: string, domain: string }>} [competitors] - Optional competitor list
 * @returns {{ mentionCount: number, citationCount: number, sentiment: string, visibilityScore: number, competitorMentions: Array, mentionPosition: number | null, mentionedEntityCount: number }}
 */
export function parseResponse(response, brand, sentiment = 'neutral', competitors = []) {
  const { text, citations } = response;
  const cleanText = stripUrls(text);

  // --- Brand mention count (on URL-stripped text to avoid double-counting) ---
  let mentionCount = countOccurrences(cleanText, brand.brandName);
  for (const domain of brand.domains) {
    mentionCount += countOccurrences(cleanText, domain);
  }

  // --- Brand citation count (hostname-based, see countOwnDomainCitations) ---
  const citationCount = countOwnDomainCitations(citations, brand.domains);

  // --- Visibility Score (0-100) ---
  const visibilityScore = computeVisibilityScore({
    mentionCount,
    citationCount,
    totalCitations: citations.length,
    sentiment,
  });

  // --- Competitor mentions (on URL-stripped text) ---
  const competitorMentions = competitors.map((comp) => {
    let compMentions = countOccurrences(cleanText, comp.name);
    if (comp.domain) {
      compMentions += countOccurrences(cleanText, comp.domain);
    }

    let compCitations = 0;
    if (comp.domain) {
      for (const cite of citations) {
        const url = (cite.url || '').toLowerCase();
        if (url.includes(comp.domain.toLowerCase())) {
          compCitations++;
        }
      }
    }

    const compScore = computeVisibilityScore({
      mentionCount: compMentions,
      citationCount: compCitations,
      totalCitations: citations.length,
      sentiment: 'neutral',
    });

    return {
      competitor_id: comp.id,
      name: comp.name,
      domain: comp.domain || '',
      mention_count: compMentions,
      citation_count: compCitations,
      visibility_score: compScore,
    };
  });

  // --- Mention order among brand + competitors (position signal) ---
  const { mentionPosition, mentionedEntityCount } = computeMentionPosition(
    text,
    brand,
    competitors,
  );

  return {
    mentionCount,
    citationCount,
    sentiment,
    visibilityScore,
    competitorMentions,
    mentionPosition,
    mentionedEntityCount,
  };
}

/**
 * Compute a 0-100 visibility score based on multiple signals.
 */
function computeVisibilityScore({ mentionCount, citationCount, totalCitations, sentiment }) {
  let score = 0;

  // Mention component (max 40 pts): each mention = 10pts, capped at 4+
  score += Math.min(mentionCount * 10, 40);

  // Citation component (max 30 pts): each citation = 15pts, capped at 2+
  score += Math.min(citationCount * 15, 30);

  // Citation ratio bonus (max 15 pts): brand citations / total citations
  if (totalCitations > 0) {
    score += Math.round((citationCount / totalCitations) * 15);
  }

  // Sentiment bonus (max 15 pts)
  if (sentiment === 'positive') score += 15;
  else if (sentiment === 'neutral' && mentionCount > 0) score += 7;

  return Math.min(score, 100);
}
