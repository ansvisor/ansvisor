import { AD_LIMITS } from '../../config/ad-limits.js';
import { factMismatches } from '../fact-mismatches.js';
import { factsForPage, namesScope, scopeWords } from '../fact-scope.js';

/**
 * Ads' claims gate (ADS-01 §7a.2 rule 5, §9.5): an ad draft is saved only
 * when it passes, checked here by rule, never by the model.
 *
 *   1. Every claim names an approved brand fact still on the site, among
 *      the ones the draft was written from (groundingFacts): a claim with no
 *      fact, or another, fails. Every number in the ad's text is one of the
 *      facts it names (a price, a trial's days or weeks, a year, a figure in
 *      the fact's words): Ads never invents one.
 *   2. Prices, the trial and the founding year pass factMismatches, the
 *      web's Trust check on the server (lib/fact-mismatches.js).
 *   3. A competitor's name or domain (the brand's `competitors`) in the ad's
 *      text fails it; a keyword naming one is dropped. §7a.2 rule 5 lets an
 *      Admin allow them per workspace, but no such setting exists yet, so
 *      they are always blocked (`competitors: 'blocked'`).
 *   4. Each field's length within its channel's limit (config/ad-limits.js),
 *      where the limit is confirmed. A field whose limit is still to confirm
 *      isn't checked, and the result says so (`limits: 'unconfirmed'`).
 */

/** Failure codes, as the API answers them. */
export const GATE_FAILURES = Object.freeze([
  'shape',
  'claim_without_fact',
  'unknown_fact',
  'number_without_fact',
  'fact_mismatch',
  'competitor_named',
  'too_long',
]);

/**
 * The facts a prompt's drafts may rest on: approved, still on the site, and
 * either the whole brand's or of a scope (a destination, operator or route)
 * the prompt names, as a page's are picked (fact-scope.js).
 */
export const groundingFacts = (facts, promptText) =>
  factsForPage(
    (facts ?? []).filter((f) => f.status === 'approved' && !f.gone),
    [promptText ?? ''],
  );

/** A number as written, its thousands grouped by a separator before exactly three digits. */
const NUMBER = /\d+(?:[.,'’]\d+)*/g;
const numbersIn = (text) =>
  [...String(text ?? '').matchAll(NUMBER)]
    .map((m) =>
      Number(
        m[0]
          .replace(/['’]/g, '')
          .replace(/[.,](?=\d{3}(?!\d))/g, '')
          .replace(',', '.'),
      ),
    )
    .filter(Number.isFinite);

/** The numbers a fact holds: its value (a trial's days, and weeks), and those in its words. */
function factNumbers(fact) {
  const v = fact.value ?? {};
  const own =
    fact.kind === 'price'
      ? [v.amount]
      : fact.kind === 'trial'
        ? [v.days, ...(v.days % 7 === 0 ? [v.days / 7] : [])]
        : fact.kind === 'founded'
          ? [v.year]
          : [];
  return [...own.filter(Number.isFinite), ...numbersIn(fact.quote)];
}

/** A competitor's names as the gate looks for them: its name, its domain and the domain's first part. */
function competitorNames(competitors, brandName) {
  const brand = scopeWords(brandName);
  return (competitors ?? []).flatMap((c) => {
    const domain = String(c?.domain ?? '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    const names = [c?.name, domain, domain.split('.')[0]].filter(
      (n) => n && scopeWords(n).length >= 3 && scopeWords(n) !== brand,
    );
    return names.length ? [{ name: c.name || domain, names }] : [];
  });
}

/** The competitor a text names, by the gate's names, or undefined. */
function rivalNaming(competitors, brandName) {
  const rivals = competitorNames(competitors, brandName);
  return (text) => rivals.find((r) => r.names.some((n) => namesScope(text, n)));
}

/**
 * Keywords as the gate keeps them (a draft's, or an export's seeds and
 * fan-outs): trimmed, each once whatever its case, and any naming a
 * competitor dropped.
 */
export function keptKeywords(list, { brandName, competitors = [] }) {
  const naming = rivalNaming(competitors, brandName);
  const keywords = [];
  const dropped = [];
  for (const raw of list ?? []) {
    const keyword = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!keyword || keywords.some((k) => k.toLowerCase() === keyword.toLowerCase())) continue;
    (naming(keyword) ? dropped : keywords).push(keyword);
  }
  return { keywords, dropped };
}

/** The draft's text, field by field: `headline`, `description`, `contextHint`, each one's place. */
const textsOf = (draft) => [
  ...(draft.headlines ?? []).map((text, i) => ({ field: 'headline', at: `headlines[${i}]`, text })),
  ...(draft.descriptions ?? []).map((text, i) => ({
    field: 'description',
    at: `descriptions[${i}]`,
    text,
  })),
  ...(draft.contextHint
    ? [{ field: 'contextHint', at: 'contextHint', text: draft.contextHint }]
    : []),
];

/** What a channel's draft has: ChatGPT one headline, one description and its context hint. */
function shapeFailures(draft) {
  const filled = (list) => Array.isArray(list) && list.length > 0 && list.every((t) => t?.trim());
  if (!AD_LIMITS[draft.channel]) return [{ code: 'shape', detail: 'channel' }];
  const out = [];
  if (!filled(draft.headlines)) out.push({ code: 'shape', at: 'headlines' });
  if (!filled(draft.descriptions)) out.push({ code: 'shape', at: 'descriptions' });
  if (draft.channel === 'chatgpt') {
    if (draft.headlines?.length > 1) out.push({ code: 'shape', at: 'headlines' });
    if (draft.descriptions?.length > 1) out.push({ code: 'shape', at: 'descriptions' });
    if (!draft.contextHint?.trim()) out.push({ code: 'shape', at: 'contextHint' });
  } else if (draft.contextHint) {
    out.push({ code: 'shape', at: 'contextHint' });
  }
  return out;
}

/**
 * Gates one draft. `facts` are the ones it was written from (groundingFacts,
 * each with its id); a claim's factId is a fact's id.
 *
 * @param {{ channel: string, headlines: string[], descriptions: string[],
 *   contextHint?: string | null, keywords?: string[],
 *   claims?: { text: string, factId: string | null }[] }} draft
 * @param {{ facts: object[], brandName: string, competitors?: { name: string, domain?: string }[],
 *   limits?: typeof AD_LIMITS }} context
 * @returns {{ passed: boolean, failures: { code: string, at?: string, detail?: unknown }[],
 *   limits: 'confirmed' | 'unconfirmed', unconfirmed: string[], competitors: 'blocked',
 *   keywords: string[], droppedKeywords: string[], factIds: string[],
 *   claims: { text: string, factId: string | null }[] }}
 */
export function gateDraft(draft, { facts, brandName, competitors = [], limits = AD_LIMITS }) {
  const failures = shapeFailures(draft);
  const texts = textsOf(draft);
  const byId = new Map((facts ?? []).map((f) => [f.id, f]));

  // 1. Claims, each on a fact given; numbers only from the facts claimed.
  const claims = (draft.claims ?? []).map((c) => ({
    text: String(c?.text ?? '').trim(),
    factId: c?.factId ? String(c.factId) : null,
  }));
  const cited = [];
  for (const claim of claims) {
    if (!claim.factId) failures.push({ code: 'claim_without_fact', detail: claim.text });
    else if (!byId.has(claim.factId)) failures.push({ code: 'unknown_fact', detail: claim.factId });
    else if (!cited.includes(claim.factId)) cited.push(claim.factId);
  }
  const backed = [...cited.flatMap((id) => factNumbers(byId.get(id))), ...numbersIn(brandName)];
  for (const { at, text } of texts) {
    for (const n of numbersIn(text)) {
      if (!backed.some((b) => Math.abs(b - n) < 0.005)) {
        failures.push({ code: 'number_without_fact', at, detail: n });
      }
    }
  }

  // 2. Prices, trial and founding year as Trust reads them.
  const { mismatches } = factMismatches({
    sentences: texts.flatMap(({ text }) => text.split(/(?<=[.!?])\s+/)),
    facts: facts ?? [],
    brandName: brandName ?? '',
    competitorDomains: (competitors ?? []).map((c) => c?.domain).filter(Boolean),
  });
  for (const { kind, page, fact } of mismatches) {
    failures.push({ code: 'fact_mismatch', detail: { kind, page, fact } });
  }

  // 3. Competitors: blocked in the text, their keywords dropped.
  const naming = rivalNaming(competitors, brandName);
  for (const { at, text } of texts) {
    const rival = naming(text);
    if (rival) failures.push({ code: 'competitor_named', at, detail: rival.name });
  }
  const { keywords, dropped: droppedKeywords } = keptKeywords(draft.keywords, {
    brandName,
    competitors,
  });

  // 4. Lengths, where the channel's limit is confirmed.
  const channelLimits = limits[draft.channel] ?? {};
  const unconfirmed = Object.keys(channelLimits).filter((field) => channelLimits[field] == null);
  for (const { field, at, text } of texts) {
    const max = channelLimits[field];
    if (max != null && [...text].length > max) {
      failures.push({ code: 'too_long', at, detail: { max, length: [...text].length } });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    limits: unconfirmed.length ? 'unconfirmed' : 'confirmed',
    unconfirmed,
    competitors: 'blocked',
    keywords,
    droppedKeywords,
    factIds: cited,
    claims,
  };
}
