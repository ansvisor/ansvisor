import { PLATFORM_LABELS } from '@/config/platform-labels';
import { PLANS } from '@/config/plans';
import { cardCopy, type CardCopy, type FeatureTag, type TargetKind } from './copy';
import type { CitedSiteKind, ReportCardEngine, ReportCardPayload } from './payload';

/**
 * What a report card says, worked out from its figures by fixed rules
 * (REPORT-CARD §1; the v5 layout, owner decisions 2026-11-04): page 1's
 * starting point and the questions missed, page 2's question grid, page 3's
 * three findings with what to do in week one and the sites to get onto,
 * page 4's value table and plan. No model writes any of it, so a card never
 * promises what the figures don't show; every word is in the card's
 * language, from ./copy.ts.
 */

/** Where the card's trial links go. */
export const REPORT_CARD_SIGN_UP_URL =
  'https://app.ansvisor.com/en/sign-up?utm_source=report-card&utm_medium=pdf';

export const engineLabel = (engine: ReportCardEngine): string => PLATFORM_LABELS[engine] ?? engine;

/** At most `max` characters, cut at a word with "…": names and questions keep each page to one. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/**
 * Whether Inter, the card's font, draws every letter of `text`: Latin, Greek
 * and Cyrillic do; Chinese, Japanese, Korean, Arabic, Hebrew, Thai and the
 * other scripts it has no letters for would print as empty boxes.
 */
export function interCanDraw(text: string): boolean {
  return /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]*$/u.test(
    text,
  );
}

/**
 * A question as the card quotes it: as asked when Inter draws it, else its
 * English (REPORT-CARD decision 2026-11-03: no font is added for other
 * scripts); null when neither can be printed.
 */
export function quotedQuestion(question: { text: string; textEn: string | null }): string | null {
  if (interCanDraw(question.text)) return question.text;
  return question.textEn && interCanDraw(question.textEn) ? question.textEn : null;
}

type Missed = ReportCardPayload['missedQuestions'][number];

/**
 * Words a brand's name may end with that don't tell it apart (server
 * lib/report-card/analyze.js, kept in step): "Jolly Tur" and "Jolly".
 */
const GENERIC_ENDINGS = [
  'turizm',
  'tourism',
  'holidays',
  'seyahat',
  'travel',
  'tours',
  'tatil',
  'tour',
  'tur',
];

/** One brand under its spellings, as the server counts it (analyze.js brandKey). */
export function brandKey(name: string): string {
  let key = name
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s,]+(inc|llc|ltd|gmbh|a\.?s|ltd\.? ?sti|co|corp|company|plc|s\.?a)\.?$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const ending = GENERIC_ENDINGS.find((w) => key.endsWith(w) && key.length - w.length >= 4);
  if (ending) key = key.slice(0, -ending.length);
  return key;
}

/** The brand a site's address names: "jollytur.com.tr" is Jolly Tur's. */
export function siteBrandKey(domain: string): string {
  const labels = domain
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);
  if (labels.length < 2) return brandKey(labels[0] ?? '');
  const second =
    labels.length >= 3 &&
    labels[labels.length - 2].length <= 3 &&
    labels[labels.length - 1].length === 2;
  return brandKey(labels[labels.length - (second ? 3 : 2)]);
}

/** The kinds of site a card may suggest getting onto: never a competitor's or a marketplace's. */
const TARGET_KINDS = new Set<CitedSiteKind>(['guide', 'publication', 'official', 'community']);
/** The order page 3 lists them in, the reviews sites last. */
export const TARGET_ORDER: readonly TargetKind[] = [
  'guide',
  'publication',
  'official',
  'community',
  'reviews',
];

type CitedSite = ReportCardPayload['citedSites'][number];

/**
 * Review and complaint sites the card knows by name (server
 * lib/report-card/analyze.js REVIEW_SITES, kept in step): on a card made
 * before sites were sorted, these are reviews sites.
 */
const REVIEW_SITES = [
  'sikayetvar.com',
  'trustpilot.com',
  'tripadvisor.com',
  'tripadvisor.com.tr',
  'tripadvisor.co.uk',
  'g2.com',
  'capterra.com',
  'getapp.com',
  'trustradius.com',
  'yelp.com',
  'reviews.io',
  'sitejabber.com',
  'productreview.com.au',
  'glassdoor.com',
];

/** A cited site's kind: as sorted, or a known reviews site on an older card. */
export function kindOf(site: CitedSite): CitedSiteKind | null {
  const domain = site.domain.toLowerCase().replace(/^www\./, '');
  if (!site.own && REVIEW_SITES.some((r) => domain === r || domain.endsWith(`.${r}`))) {
    return 'reviews';
  }
  return site.kind ?? null;
}

/**
 * Whether the card may suggest getting onto a cited site: a guide,
 * publication, official source or community. A card made before sites were
 * sorted suggests any site that isn't the company's and whose address
 * doesn't name a competitor or marketplace the answers named.
 */
export function isTargetSite(site: CitedSite, card: ReportCardPayload): boolean {
  if (site.own || site.competitor) return false;
  const kind = kindOf(site);
  if (kind) return TARGET_KINDS.has(kind);
  if (card.citedSites.some((s) => s.kind)) return false;
  const brands = new Set(
    [...card.competitors, ...(card.marketplaces ?? [])].map((c) => brandKey(c.name)),
  );
  return !brands.has(siteBrandKey(site.domain)) && !competitorSite(site.domain, card.competitors);
}

/**
 * The site the card suggests working on: the guide, publication, official
 * source or community AI cites most; else the reviews site it cites most,
 * whose step is to answer what customers say (owner review 2026-11-04).
 */
export function targetSite(card: ReportCardPayload): CitedSite | null {
  return (
    card.citedSites.find((s) => isTargetSite(s, card)) ??
    card.citedSites.find((s) => !s.own && kindOf(s) === 'reviews') ??
    null
  );
}

/** A name as compared: lower case, without accents or punctuation. */
const nameKey = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** How long a name or a question may run in the card's sentences. */
const NAME_MAX = 40;
const QUESTION_MAX = 110;

/** Whole percent of `part` in `whole`, 0 for an empty whole. */
export const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** Ansvisor Starter's engines: a card's main result (owner decision 2026-11-04). */
export const STARTER_ENGINES: readonly ReportCardEngine[] = ['chatgpt-web', 'gemini-web'];

type EngineRow = ReportCardPayload['engines'][number];

/** The engines the card's headline counts: Starter's; every engine on an older card. */
export function mainEngineRows(card: ReportCardPayload): EngineRow[] {
  const main = card.mainEngines;
  if (!main?.length) return card.engines;
  return card.engines.filter((e) => main.includes(e.engine));
}

/** The engines shown apart, in Growth's band: none on an older card. */
export function growthEngineRows(card: ReportCardPayload): EngineRow[] {
  const main = card.mainEngines;
  if (!main?.length) return [];
  return card.engines.filter((e) => !main.includes(e.engine));
}

/** "ChatGPT and Gemini", in the card's language. */
export const engineList = (rows: readonly EngineRow[], t: CardCopy = cardCopy()): string =>
  t.list(rows.map((e) => engineLabel(e.engine)));

export interface Totals {
  answers: number;
  named: number;
  /** The card's visibility: the share of answers that name the company. */
  visibility: number;
}

/** Every engine's answers: how many answers the card got in all. */
export function totals(card: ReportCardPayload): Totals {
  const answers = card.engines.reduce((sum, e) => sum + e.answers, 0);
  const named = card.engines.reduce((sum, e) => sum + e.named, 0);
  return { answers, named, visibility: percent(named, answers) };
}

/**
 * The headline: the share of the main engines' answers that name the
 * company (Starter's, ChatGPT and Gemini). Every figure the card
 * states beside it (the findings, the competitors, the sites and the
 * e-mail) counts these same answers: the server counts the competitors,
 * sites and own citations over the main engines too.
 */
export function mainTotals(card: ReportCardPayload): Totals {
  return totals({ ...card, engines: mainEngineRows(card) });
}

// ─── Names and sites ─────────────────────────────────────────────────────────

/** A company's name as compared with a site's: nameKey without "Inc.", "Ltd" and the like. */
const companyKey = (name: string): string =>
  nameKey(
    name.replace(/ı/g, 'i').replace(/[\s,]+(inc|llc|ltd|gmbh|co|corp|company|plc)\.?$/iu, ''),
  );

/**
 * Whether a cited site is a listed competitor's own (as the server's
 * competitorSite): a label of its host, the top-level domain aside, is a
 * competitor's name or begins one. For cards made before the server marked it.
 */
export function competitorSite(domain: string, competitors: readonly { name: string }[]): boolean {
  const keys = competitors.map((c) => companyKey(c.name)).filter(Boolean);
  return domain
    .split('.')
    .slice(0, -1)
    .map(companyKey)
    .some(
      (label) =>
        !!label &&
        keys.some((key) => key === label || (label.length >= 4 && key.startsWith(label))),
    );
}

// ─── Page 1 and 3: the findings ──────────────────────────────────────────────

export interface QuickWin {
  /** What to do, with what it's about. */
  title: string;
  /** What the card found that makes it worth doing. */
  detail: string;
  /** What you'd do about it in your first week. */
  week: string;
  /** Where Ansvisor helps with it. */
  feature: FeatureTag;
}

/** A question's product page, without the scheme, when the card knows it. */
function productPage(card: ReportCardPayload, product: number | null | undefined): string | null {
  const url = typeof product === 'number' ? card.products?.[product]?.url : null;
  return url ? clip(url.replace(/^https?:\/\/(www\.)?/, ''), 50) : null;
}

/** The question competitors win most: one the top three name; else the one most engines answered. */
export function leadQuestion(card: ReportCardPayload): Missed | null {
  const topThree = new Set(card.competitors.slice(0, 3).map((c) => nameKey(c.name)));
  const main = (q: Missed) => q.competitors.filter((name) => topThree.has(nameKey(name))).length;
  const quotable = card.missedQuestions.filter((q) => quotedQuestion(q));
  return (
    quotable
      .filter((q) => main(q) > 0)
      .sort((a, b) => main(b) - main(a) || b.competitors.length - a.competitors.length)[0] ??
    [...quotable].sort((a, b) => (b.answers ?? 0) - (a.answers ?? 0))[0] ??
    null
  );
}

/** The step for the site to get onto, by its kind. */
function targetWin(site: CitedSite, card: ReportCardPayload, t: CardCopy): QuickWin {
  const company = clip(card.companyName, NAME_MAX);
  const domain = clip(site.domain, NAME_MAX);
  const { answers } = mainTotals(card);
  const kind = kindOf(site);
  const copy = t.wins.target[kind && kind in t.wins.target ? (kind as TargetKind) : 'other'];
  return {
    title: copy.title(company, domain),
    detail: copy.detail(site.answers, answers),
    week: copy.week(company, domain),
    feature: 'citations',
  };
}

/**
 * The card's three findings, the first that apply in this order: answer
 * the question competitors win; get onto the guide, publication, official
 * source or community AI cites most (a reviews site only when none is);
 * put the brand's name where AI already cites its pages without naming it,
 * or make its pages easy to cite; close the gap on the leading competitor;
 * work on the Starter engine that names it least. Each with what to do in
 * week one and where Ansvisor helps.
 */
export function quickWins(card: ReportCardPayload, t: CardCopy = cardCopy(card)): QuickWin[] {
  const headline = mainTotals(card);
  const { answers, named } = headline;
  const company = clip(card.companyName, NAME_MAX);
  const wins: QuickWin[] = [];

  const missed = leadQuestion(card);
  const quoted = missed ? quotedQuestion(missed) : null;
  if (missed && quoted) {
    const topThree = new Set(card.competitors.slice(0, 3).map((c) => nameKey(c.name)));
    const names = [...missed.competitors]
      .sort((a, b) => Number(topThree.has(nameKey(b))) - Number(topThree.has(nameKey(a))))
      .slice(0, 3)
      .map((name) => clip(name, NAME_MAX));
    wins.push({
      title: t.wins.question.title(clip(quoted, QUESTION_MAX)),
      detail: names.length
        ? t.wins.question.detailNames(t.list(names), company)
        : t.wins.question.detailNone(company),
      week: t.wins.question.week(productPage(card, missed.product)),
      feature: 'contentEditor',
    });
  }

  const target = targetSite(card);
  if (target) wins.push(targetWin(target, card, t));

  if (headline.named === 0 && card.ownCitations > 0) {
    // AI reads the site but doesn't say the name: the best place to start.
    wins.push({
      title: t.wins.ownName.title,
      detail: t.wins.ownName.detail(card.ownCitations, company),
      week: t.wins.ownName.week,
      feature: 'siteAudit',
    });
  } else if (percent(card.ownCitations, answers) < 10) {
    wins.push({
      title: t.wins.ownPages.title,
      detail: t.wins.ownPages.detail(card.ownCitations, answers),
      week: t.wins.ownPages.week,
      feature: 'siteAudit',
    });
  }

  const leader = card.competitors[0];
  if (leader && leader.answers > named) {
    const rival = clip(leader.name, NAME_MAX);
    wins.push({
      title: t.wins.gap.title(rival),
      detail: t.wins.gap.detail(rival, leader.answers, company, named),
      week: t.wins.gap.week(rival),
      feature: 'competitors',
    });
  }

  // Among Starter's engines (every engine on an older card), and only when
  // they differ: with one engine, or all alike, none is the weakest.
  const mainRows = mainEngineRows(card);
  const shares = mainRows.map((e) => percent(e.named, e.answers));
  const weakest = [...mainRows].sort(
    (a, b) => percent(a.named, a.answers) - percent(b.named, b.answers),
  )[0];
  if (weakest && Math.min(...shares) < Math.max(...shares)) {
    const engine = engineLabel(weakest.engine);
    wins.push({
      title: t.wins.weakest.title(engine),
      detail: t.wins.weakest.detail(
        weakest.named,
        weakest.answers,
        card.mainEngines?.length ? engineList(mainRows, t) : t.engines.the(mainRows.length),
      ),
      week: t.wins.weakest.week(engine),
      feature: 'brandVisibility',
    });
  }

  // A company that leads everywhere, named alike by every engine, still gets one step.
  if (!wins.length) {
    wins.push({
      title: t.wins.keep.title(company),
      detail: t.wins.keep.detail(named, answers),
      week: t.wins.keep.week,
      feature: 'brandVisibility',
    });
  }

  return wins.slice(0, 3);
}

// ─── Page 1: the starting point and the questions missed ────────────────────

/**
 * The starting point (owner decision 2026-11-04: a zero is where a brand
 * starts, not a failure): when no Starter engine named the company, and
 * whether AI already cites its pages; null when it is named.
 */
export function startingPoint(card: ReportCardPayload): { cited: number } | null {
  return mainTotals(card).named === 0 ? { cited: card.ownCitations } : null;
}

export interface MissedLine {
  text: string;
  instead: string[];
}

/** Page 1's questions missed: the five competitors win most, as the server ranked them. */
export function topMissed(card: ReportCardPayload, count = 5): MissedLine[] {
  return card.missedQuestions
    .map((q) => ({ q, text: quotedQuestion(q) }))
    .filter((row): row is { q: Missed; text: string } => row.text !== null)
    .slice(0, count)
    .map(({ q, text }) => ({
      text: clip(text, QUESTION_ROW_MAX),
      instead: q.competitors.slice(0, 3).map((name) => clip(name, 28)),
    }));
}

/** The marketplaces and other businesses named, apart from the competitors: a line each. */
export function alsoNamed(card: ReportCardPayload, t: CardCopy = cardCopy(card)): string[] {
  const names = (list?: { name: string }[]) =>
    (list ?? [])
      .slice(0, 4)
      .map((n) => clip(n.name, 28))
      .join(', ');
  return [
    card.marketplaces?.length ? t.status.alsoMarketplaces(names(card.marketplaces)) : null,
    card.otherNames?.length ? t.status.alsoOthers(names(card.otherNames)) : null,
  ].filter((line): line is string => line !== null);
}

/** The products the card read the site as selling, as page 1 lists them. */
export function productNames(card: ReportCardPayload): string[] {
  return (card.products ?? []).map((p) => clip(productLabel(p), 40));
}

// ─── Page 2: the questions ───────────────────────────────────────────────────

/** How long a question may run on page 2: two lines at most, so 25 fit with their groups. */
export const QUESTION_ROW_MAX = 90;
const RELATED_ROW_MAX = 48;

export type Mark = 'named' | 'missed' | 'none';

export interface QuestionLine {
  /** The question's number on the card, from 1. */
  number: number;
  /** The question as the card quotes it: as asked, or its English. */
  text: string;
  /** Each engine's answer: named the company, didn't, or gave none. */
  named: Partial<Record<ReportCardEngine, Mark>>;
  /** The competitor named most in its answers, if any. */
  instead: string | null;
  /** Its keyword's Google searches a month; null when unknown. */
  volume: number | null;
  /** Why it was chosen: about a main product, or a need the same buyers have. */
  fit: 'core' | 'related' | null;
}

export interface QuestionGroup {
  /** The product or category the questions are about; null on older cards. */
  product: string | null;
  /** Its page on the site, without the scheme. */
  page: string | null;
  lines: QuestionLine[];
}

/** A product as the card names it: as the site does, or its English. */
export function productLabel(product: { name: string; nameEn: string | null }): string {
  if (interCanDraw(product.name)) return product.name;
  return product.nameEn && interCanDraw(product.nameEn) ? product.nameEn : product.name;
}

/** Page 2's rows: every question asked, quoted as page 1 quotes one. */
export function questionLines(card: ReportCardPayload): QuestionLine[] {
  return (card.questionRows ?? []).map((row, i) => ({
    number: i + 1,
    // A related question carries a note under it: one line, so the row keeps to two.
    text: clip(
      quotedQuestion(row) ?? row.textEn ?? row.text,
      row.fit === 'related' ? RELATED_ROW_MAX : QUESTION_ROW_MAX,
    ),
    named: row.named,
    instead: row.instead ? clip(row.instead, 28) : null,
    volume: row.volume ?? null,
    fit: row.fit ?? null,
  }));
}

/**
 * Page 2's rows grouped by the product they ask about, in the products'
 * order (the main one first); one group without a product on a card made
 * before products were found.
 */
export function questionGroups(card: ReportCardPayload): QuestionGroup[] {
  const lines = questionLines(card);
  const products = card.products ?? [];
  const rows = card.questionRows ?? [];
  const groups = new Map<number, QuestionLine[]>();
  const loose: QuestionLine[] = [];
  lines.forEach((line, i) => {
    const product = rows[i]?.product;
    if (typeof product === 'number' && products[product]) {
      groups.set(product, [...(groups.get(product) ?? []), line]);
    } else {
      loose.push(line);
    }
  });
  const out: QuestionGroup[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, groupLines]) => ({
      product: clip(productLabel(products[index]), 60),
      page: productPage(card, index),
      lines: groupLines,
    }));
  if (loose.length) out.push({ product: null, page: null, lines: loose });
  return out;
}

/**
 * Page 2's one-line summary, above the grid: none named, or how many of the
 * main engines' answers named the company and in how many questions.
 */
export function questionSummary(
  card: ReportCardPayload,
  t: CardCopy = cardCopy(card),
): string | null {
  const rows = card.questionRows ?? [];
  if (!rows.length) return null;
  const mainRows = mainEngineRows(card);
  const main = new Set(mainRows.map((e) => e.engine));
  let answers = 0;
  let named = 0;
  let questions = 0;
  for (const row of rows) {
    const marks = Object.entries(row.named)
      .filter(([engine]) => main.has(engine as ReportCardEngine))
      .map(([, mark]) => mark);
    answers += marks.filter((mark) => mark !== 'none').length;
    const here = marks.filter((mark) => mark === 'named').length;
    named += here;
    if (here > 0) questions += 1;
  }
  const company = clip(card.companyName, NAME_MAX);
  const engines = engineList(mainRows, t);
  return named === 0
    ? t.questions.summaryNone(company, answers, rows.length, engines, mainRows.length)
    : t.questions.summary(named, answers, questions, rows.length, engines);
}

// ─── Page 3: the sites to get onto ───────────────────────────────────────────

export interface TargetGroup {
  kind: TargetKind | 'other';
  sites: { domain: string; answers: number }[];
}

/**
 * The sites AI cites that a brand can get onto, by kind, and the ones left
 * out: competitors' sites and marketplaces. A card made before sites were
 * sorted lists the sites it may suggest under "other".
 */
export function targetGroups(card: ReportCardPayload): {
  groups: TargetGroup[];
  leftOut: string[];
} {
  const sorted = card.citedSites.some((s) => s.kind);
  const groups: TargetGroup[] = [];
  const kinds: (TargetKind | 'other')[] = sorted ? [...TARGET_ORDER] : ['reviews', 'other'];
  for (const kind of kinds) {
    const sites = card.citedSites
      .filter((s) => !s.own && !s.competitor)
      .filter((s) => (kind === 'other' ? isTargetSite(s, card) && !kindOf(s) : kindOf(s) === kind))
      .slice(0, 3)
      .map((s) => ({ domain: clip(s.domain, 30), answers: s.answers }));
    if (sites.length || sorted) groups.push({ kind, sites });
  }
  const leftOut = card.citedSites
    .filter(
      (s) =>
        !s.own &&
        (s.competitor ||
          kindOf(s) === 'competitor' ||
          kindOf(s) === 'marketplace' ||
          (!sorted && !isTargetSite(s, card) && kindOf(s) !== 'reviews')),
    )
    .map((s) => clip(s.domain, 30));
  return { groups, leftOut };
}

/** A prompt the card's buyers ask, to show what Ansvisor tracks: the question competitors win. */
export function examplePrompt(card: ReportCardPayload): string | null {
  const missed = leadQuestion(card);
  const quoted = missed ? quotedQuestion(missed) : null;
  return quoted ? clip(quoted, QUESTION_MAX) : null;
}

// ─── Page 4: value and plan ──────────────────────────────────────────────────

/**
 * Keywords with a cost per click a value table needs: a median of fewer
 * swings with one keyword (owner decision 2026-11-03, after a real card's
 * median came from two).
 */
export const MIN_CPC_KEYWORDS = 5;
/**
 * The highest median cost per click a card prices visits with (owner
 * decision 2026-11-04): a guard against bad data only. Real B2B and SaaS
 * medians of $30–50 are priced, as the table is scaled to the brand's own
 * searches, and they are those brands' strongest case.
 */
export const MAX_CPC_USD = 100;

/** Whether the card's ad data can price visits: none, implausible, or usable. */
export function adsVerdict(
  card: ReportCardPayload,
): { kind: 'none' } | { kind: 'odd' | 'ok'; usd: number; keywords: number } {
  if (!card.cpc || card.cpc.keywords < MIN_CPC_KEYWORDS) return { kind: 'none' };
  return {
    kind: card.cpc.usd > MAX_CPC_USD ? 'odd' : 'ok',
    usd: card.cpc.usd,
    keywords: card.cpc.keywords,
  };
}

/** The questions' keywords' Google searches a month, added up; null without volumes. */
export function questionDemand(
  card: ReportCardPayload,
): { searches: number; keywords: number } | null {
  const volumes = (card.questionRows ?? [])
    .map((row) => row.volume)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (!volumes.length) return null;
  return { searches: volumes.reduce((sum, v) => sum + v, 0), keywords: volumes.length };
}

/** Shares of the questions' searches the value table prices as AI visits. */
export const DEMAND_SHARES = [0.02, 0.05, 0.1] as const;
/** The fixed rows a card without search volumes prices. */
export const VISIT_ROWS = [100, 1_000, 10_000] as const;

export interface ValueRow {
  /** The share of the questions' searches; null on a fixed row. */
  share: number | null;
  visits: number;
  /** What the same visits would cost a month in Google Ads, in USD. */
  monthly: number;
  yearly: number;
}

/** The visits a card prices: shares of its questions' searches, or the fixed rows. */
function visitRows(card: ReportCardPayload): { share: number | null; visits: number }[] {
  const demand = questionDemand(card);
  if (demand && demand.searches >= 100) {
    return DEMAND_SHARES.map((share) => ({
      share,
      visits: Math.max(1, Math.round(demand.searches * share)),
    }));
  }
  return VISIT_ROWS.map((visits) => ({ share: null, visits }));
}

/**
 * The value table (owner decision 2026-11-04: scaled to the brand's own
 * question volume): 2%, 5% and 10% of the questions' searches priced at the
 * median cost per click; null when the ad data can't price them.
 */
export function valueRows(card: ReportCardPayload): ValueRow[] | null {
  const ads = adsVerdict(card);
  if (ads.kind !== 'ok') return null;
  return visitRows(card).map(({ share, visits }) => {
    const monthly = Math.round(visits * ads.usd);
    return { share, visits, monthly, yearly: monthly * 12 };
  });
}

export type ComparedPlan = 'starter' | 'growth';

export function planMonthly(plan: ComparedPlan): number {
  return PLANS[plan].pricing?.monthly ?? 0;
}

/** The yearly price, paid yearly: 20% off twelve months. */
export function planYearly(plan: ComparedPlan): number {
  return PLANS[plan].pricing?.annual ?? planMonthly(plan) * 12;
}

/** The prompts a plan tracks every day. */
export const planPrompts = (plan: ComparedPlan): number => PLANS[plan].limits.maxPrompts;

/** The brands a plan tracks. */
export const planBrands = (plan: ComparedPlan): number => PLANS[plan].limits.maxBrands;

/**
 * Buying the visits vs earning them: the middle row's ad cost against
 * Starter, the plan this card measured. `cheap` when the ads would cost
 * less than Starter: the card says so instead of claiming a saving.
 */
export function buyVsEarn(card: ReportCardPayload) {
  const row = valueRows(card)?.[1];
  if (!row) return null;
  const starter = planMonthly('starter');
  return {
    visits: row.visits,
    adsMonthly: row.monthly,
    adsYearly: row.yearly,
    starterMonthly: starter,
    cheap: row.monthly < starter,
  };
}

/**
 * The conversion rates the revenue scenario assumes, by the site's kind: an
 * online shop's visit to an order, a B2B or app visit to a closed deal. AI
 * visits aren't assumed to convert better.
 */
export function conversionRange(siteType: ReportCardPayload['siteType']): {
  low: number;
  high: number;
  kind: 'order' | 'deal';
} {
  return siteType === 'ecommerce' || siteType === 'b2c'
    ? { low: 0.01, high: 0.03, kind: 'order' }
    : { low: 0.005, high: 0.01, kind: 'deal' };
}

export interface RevenueRow {
  visits: number;
  /** Revenue a month at the low rate, and at the high one. */
  low: number;
  high: number;
}

/** The revenue scenario over the value table's visits, or null without a deal value. */
export function revenueRows(card: ReportCardPayload): RevenueRow[] | null {
  if (!card.dealValue) return null;
  const { amount } = card.dealValue;
  const { low, high } = conversionRange(card.siteType);
  return visitRows(card).map(({ visits }) => ({
    visits,
    low: Math.round(visits * low * amount),
    high: Math.round(visits * high * amount),
  }));
}

/** "$1,850" or "€1,850": whole units, in the card's locale. */
export function money(amount: number, currency = 'USD', locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString(locale)} ${currency}`;
  }
}

/** "$1.85": a cost per click, to the cent. */
export const cents = (amount: number, currency = 'USD', locale = 'en-US'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);

/** A whole number in the card's locale: "12,400". */
export const count = (value: number, locale = 'en-US'): string =>
  new Intl.NumberFormat(locale).format(Math.round(value));
