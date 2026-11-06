import type { useTranslations } from 'next-intl';
import { normalizeDomain } from '@/lib/citations/classify';
import {
  FRESH_MONTHS,
  trustGain,
  type ClaimMark,
  type TrustCheckId,
  type TrustRead,
} from './quality-checks';
import type { AiCheck } from './page-read';
import {
  readabilityGain,
  SECTION_WORDS,
  type Readability,
  type ReadabilityCheck,
} from './readability';

/**
 * What would raise a page's Quality scores, in the Content Editor's words
 * (Instructions › Quality, Quality spec §3): Readability's and Trust's
 * suggestions, read from the scores the editor computes. The Quality tab
 * lists them, Before you publish warns with Trust's, and Chat's
 * check_draft_rules says them (CHAT-25 §6, W4-12b part 2). Pure.
 */

type ScoreName = 'eeat' | 'trust' | 'readability';

/** A suggestion that would raise a score, in the Quality tab's words. */
export interface Suggestion {
  key: string;
  // E-E-A-T's are the person's to-dos.
  score: Exclude<ScoreName, 'eeat'>;
  gain: number;
  line: string;
  detail: string;
  /** The passage Show goes to, if any. */
  show: string | null;
  /** The source Keep keeps (CE-046): the person trusts it all the same. */
  keep?: string;
  /** The claim whose words Add source selects to link, and whose sentence Remove takes out (CE-045). */
  claim?: ClaimMark;
  /** Read by AI, not by rules alone: it says so (spec §3, "AI check"). */
  ai?: boolean;
  /**
   * Hand off leaves it to the person (CE-051): it asks the other way to what
   * the agent is told for its check (sentences too short, a page too simple).
   */
  handOff?: false;
}

/** The editor's Quality words (contentEditor.editor.quality), from the page or the server. */
export type QualityT = ReturnType<typeof useTranslations<'contentEditor.editor.quality'>>;
type T = QualityT;

/** Readability's suggestions, each check's line and what to do. */
export function readabilitySuggestions(t: T, readability: Readability | null): Suggestion[] {
  if (!readability || readability.score === null) return [];
  return readability.checks.map(
    (check): Suggestion => ({
      key: `readability:${check.id}`,
      score: 'readability',
      gain: readabilityGain(readability, check.id),
      line: line(t, check),
      detail: detail(t, check),
      show: check.at || null,
      ...(check.ai ? { ai: true } : {}),
      ...(againstHandOff(check) ? { handOff: false as const } : {}),
    }),
  );
}

/** Asks for longer sentences or a harder read: the hand-off's checks say shorter and easier. */
const againstHandOff = (check: ReadabilityCheck) =>
  (check.id === 'avgSentence' && check.count < 0) ||
  (check.id === 'readingLevel' && !!check.band && check.count > 0);

/** A Trust suggestion: its check, and how many it names (Before you publish's warning). */
export type TrustSuggestion = Suggestion & { check: TrustCheckId; count: number };

/**
 * Trust's: figures without a source, sources past FRESH_MONTHS, links that
 * don't answer, each with Show on the first one in the page. A broken link
 * is listed before Trust is scored too, its gain out of the Phase 1 points.
 * Phase 2 (CE-046): weak or competitors' sources, Show and Keep on the first,
 * and no primary source among them. Phase 2 (CE-047): a price, trial or
 * founding year that differs from the brand's approved facts, listed before
 * Trust is scored too, as a broken link is.
 */
export function trustSuggestions(
  t: T,
  trust: TrustRead | null,
  covered: ReadonlySet<string> = new Set(),
  /**
   * Phase 2 (CE-050): the page read's balance and disclosure, each with the
   * passage Show goes to (where the page puts the brand forward), and the
   * brand's name for their lines.
   */
  page: { balanced: AiCheck | null; disclosure: AiCheck | null; brand: string } | null = null,
): TrustSuggestion[] {
  if (!trust) return [];
  const out: TrustSuggestion[] = [];
  // A sentence a proof to-do asks the person to prove isn't the agent's to
  // source as well (CE-049).
  const unsourced = trust.unsourced.filter((sentence) => !covered.has(sentence));
  if (unsourced.length) {
    // Phase 2 (CE-045): claims the model read count with the figures, so
    // the line says claims; Add source and Remove act on the page's first.
    const claims = trust.aiClaims > 0;
    const first = unsourced[0];
    out.push({
      key: 'trust:claimsSourced',
      check: 'claimsSourced',
      score: 'trust',
      // Each sentence's share: the covered ones' is their to-dos'.
      gain: Math.round(
        (trustGain(trust, ['claimsSourced']) * unsourced.length) / trust.unsourced.length,
      ),
      line: t(claims ? 'checks.claimsSourced.lineClaims' : 'checks.claimsSourced.line', {
        count: unsourced.length,
      }),
      count: unsourced.length,
      detail: t(claims ? 'checks.claimsSourced.detailClaims' : 'checks.claimsSourced.detail'),
      show: first,
      ai: claims,
      claim: trust.marks.find((mark) => mark.sentence === first),
    });
  }
  if (trust.mismatches.length) {
    const [first] = trust.mismatches;
    out.push({
      key: 'trust:brandFacts',
      check: 'brandFacts',
      score: 'trust',
      gain: trustGain(trust, ['brandFacts']),
      line: t('checks.brandFacts.line', {
        kind: first.kind,
        page: first.page,
        source: first.source,
        fact: first.fact,
      }),
      count: trust.mismatches.length,
      detail: t('checks.brandFacts.detail', { count: trust.mismatches.length }),
      show: first.sentence,
    });
  }
  // Phase 3 (CE-053): the person checks which is right, the page or the
  // feed: Hand off leaves it (it isn't one of its keys).
  const feed = trust.feed ?? [];
  if (feed.length) {
    const [first] = feed;
    out.push({
      key: 'trust:feedMatch',
      check: 'feedMatch',
      score: 'trust',
      gain: trustGain(trust, ['feedMatch']),
      line: t('checks.feedMatch.line', {
        kind: first.kind,
        page: first.page,
        feed: first.feed,
      }),
      count: feed.length,
      detail: t('checks.feedMatch.detail', { count: feed.length }),
      show: first.sentence || null,
    });
  }
  if (trust.stale.length) {
    out.push({
      key: 'trust:freshSources',
      check: 'freshSources',
      score: 'trust',
      gain: trustGain(trust, ['freshSources']),
      count: trust.stale.length,
      line: t('checks.freshSources.line', {
        count: trust.stale.length,
        total: trust.dated,
        months: FRESH_MONTHS,
      }),
      detail: t('checks.freshSources.detail'),
      show: trust.stale[0].text,
    });
  }
  // Only once Trust is scored: their gain out of the Phase 1 points would be made up.
  if (trust.weak.length && trust.score !== null) {
    const [first] = trust.weak;
    out.push({
      key: 'trust:noWeakSources',
      check: 'noWeakSources',
      score: 'trust',
      gain: trustGain(trust, ['noWeakSources']),
      line: t('checks.noWeakSources.line', { count: trust.weak.length }),
      count: trust.weak.length,
      detail: t('checks.noWeakSources.detail', {
        host: normalizeDomain(first.url),
        kind: first.kind,
      }),
      show: first.text,
      keep: first.url,
      ai: trust.weak.some((w) => w.ai),
    });
  }
  const primary = trust.checks.find((c) => c.id === 'primarySources');
  if (primary && primary.points < primary.max && trust.score !== null) {
    out.push({
      key: 'trust:primarySources',
      check: 'primarySources',
      score: 'trust',
      gain: trustGain(trust, ['primarySources']),
      line: t('checks.primarySources.line'),
      count: 1,
      detail: t('checks.primarySources.detail'),
      show: null,
    });
  }
  // The page read's (CE-050), once Trust is scored, as the sources' kinds.
  for (const id of ['disclosure', 'balanced'] as const) {
    const read = page?.[id];
    if (!read || read.found || trust.score === null) continue;
    out.push({
      key: `trust:${id}`,
      check: id,
      score: 'trust',
      gain: trustGain(trust, [id]),
      // Before the brand's name is read: "your brand".
      line: t(`checks.${id}.line`, { brand: page!.brand || t('yourBrand') }),
      count: 1,
      detail: t(`checks.${id}.detail`, { brand: page!.brand || t('yourBrand') }),
      show: read.show,
      ai: true,
    });
  }
  if (trust.broken.length) {
    out.push({
      key: 'trust:noBrokenLinks',
      check: 'noBrokenLinks',
      score: 'trust',
      gain: trustGain(trust, ['noBrokenLinks']),
      line: t('checks.noBrokenLinks.line', { count: trust.broken.length }),
      count: trust.broken.length,
      detail: t('checks.noBrokenLinks.detail', {
        count: trust.broken.length,
        url: trust.broken[0].url,
      }),
      show: trust.broken[0].text,
    });
  }
  return out;
}

/** A Readability check's one line: what the draft does now. */
function line(t: T, check: ReadabilityCheck): string {
  switch (check.id) {
    case 'avgSentence':
      return t('checks.avgSentence.line', { words: check.value });
    case 'longSentences':
      return t('checks.longSentences.line', { count: check.count });
    case 'readingLevel':
      return check.formula
        ? t('checks.readingLevel.line', {
            score: check.value,
            formula: t(`formulas.${check.formula}`),
          })
        : t('checks.readingLevel.lineLength');
    case 'answerFirst':
      return t('checks.answerFirst.line');
    case 'shortParagraphs':
      return t('checks.shortParagraphs.line', { count: check.count });
    case 'headingSpacing':
      return t('checks.headingSpacing.line', { count: check.count, words: SECTION_WORDS });
    case 'passiveJargon':
      return t('checks.passiveJargon.line', { passive: check.count, jargon: check.value });
    case 'typeRules':
      return t('checks.typeRules.line', {
        count: check.count,
        names: (check.rules ?? []).map((r) => r.name).join(', '),
      });
  }
}

/** Its detail line: what to do. */
function detail(t: T, check: ReadabilityCheck): string {
  if (check.id === 'avgSentence' && check.count < 0) return t('checks.avgSentence.detailShort');
  if (check.id === 'readingLevel') {
    // English reads by its band (as Site Audit does): over it, the page reads too simple.
    if (check.band) {
      return check.count > 0
        ? t('checks.readingLevel.detailSimple', check.band)
        : t('checks.readingLevel.detailBand', check.band);
    }
    return check.formula
      ? t('checks.readingLevel.detail', { target: check.target ?? 60 })
      : t('checks.readingLevel.detailLength');
  }
  // Each rule with its aim and how the page reads now: what Hand off sends the agent too.
  if (check.id === 'typeRules') {
    return t('checks.typeRules.detail', {
      rules: (check.rules ?? [])
        .map((r) => (r.detail ? `${r.name} (${r.detail})` : r.name))
        .join('; '),
    });
  }
  return t(`checks.${check.id}.detail`);
}
