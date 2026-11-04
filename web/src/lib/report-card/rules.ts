import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { PLANS } from '@/config/plans';
import { formatNumber } from '@/lib/format';
import { helpLine, type HelpLine } from './help-lines';
import type { ReportCardEngine, ReportCardPayload } from './payload';

/**
 * What a report card says, worked out from its figures by fixed rules: the
 * three things to do now, the action plan's steps, the value table and the
 * revenue scenario. No model writes any of it, so a card never promises what
 * the figures don't show; what each feature does is word for word from its
 * approved Help article (./help-lines.ts).
 */

/** Where the card's trial links go. */
export const REPORT_CARD_SIGN_UP_URL =
  'https://app.ansvisor.com/en/sign-up?utm_source=report-card&utm_medium=pdf';

/** Countries whose English name takes "the": "in the United States". */
const WITH_THE = new Set(['US', 'GB', 'NL', 'AE', 'PH', 'CZ', 'DO', 'BS', 'GM', 'CF', 'KM', 'MV']);

/** The country as a sentence names it: "the United States", "Türkiye". */
export const countryName = (country: ReportCardPayload['country']): string =>
  WITH_THE.has(country.code.toUpperCase()) ? `the ${country.name}` : country.name;

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

/** How long a name or a question may run in the card's sentences. */
const NAME_MAX = 40;
const QUESTION_MAX = 110;

/** Whole percent of `part` in `whole`, 0 for an empty whole. */
export const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

export interface Totals {
  answers: number;
  named: number;
  /** The card's visibility: the share of answers that name the company. */
  visibility: number;
}

export function totals(card: ReportCardPayload): Totals {
  const answers = card.engines.reduce((sum, e) => sum + e.answers, 0);
  const named = card.engines.reduce((sum, e) => sum + e.named, 0);
  return { answers, named, visibility: percent(named, answers) };
}

// ─── Page 1: three things to do now ──────────────────────────────────────────

/** "two", "three", "four": how many engines a card asked. */
const ENGINE_COUNT: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four' };

/** A name as compared: lower case, letters and digits only ("Acme Inc." → "acmeinc"). */
const nameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s,]+(inc|llc|ltd|gmbh|co|corp|company|plc)\.?$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Whether a cited site is a listed competitor's own (as the server's
 * competitorSite): a label of its host, the top-level domain aside, is a
 * competitor's name or begins one. For cards made before the server marked it.
 */
export function competitorSite(domain: string, competitors: readonly { name: string }[]): boolean {
  const keys = competitors.map((c) => nameKey(c.name)).filter(Boolean);
  return domain
    .split('.')
    .slice(0, -1)
    .map(nameKey)
    .some(
      (label) =>
        !!label &&
        keys.some((key) => key === label || (label.length >= 4 && key.startsWith(label))),
    );
}

export interface QuickWin {
  title: string;
  detail: string;
}

/** "A", "A and B", "A, B and C". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Three things to do now, the first that apply in this order: answer the
 * question competitors win, get onto the site AI cites most, make your own
 * pages citable, close the gap on the leading competitor, and work on the
 * engine that names you least.
 */
export function quickWins(card: ReportCardPayload): QuickWin[] {
  const { answers, named } = totals(card);
  const company = clip(card.companyName, NAME_MAX);
  const wins: QuickWin[] = [];

  const missed = card.missedQuestions.find((q) => q.competitors.length > 0 && quotedQuestion(q));
  const quoted = missed ? quotedQuestion(missed) : null;
  if (missed && quoted) {
    wins.push({
      title: `Answer “${clip(quoted, QUESTION_MAX)}” on your site`,
      detail: `AI names ${listOf(missed.competitors.slice(0, 3).map((name) => clip(name, NAME_MAX)))} for it, and not ${company}. A page that answers it directly gives AI engines something of yours to cite.`,
    });
  }

  // Not the company's own site, nor a competitor's: a listing there helps no one.
  const thirdParty = card.citedSites.find(
    (s) => !s.own && !s.competitor && !competitorSite(s.domain, card.competitors),
  );
  if (thirdParty) {
    wins.push({
      title: `Get ${company} onto ${clip(thirdParty.domain, NAME_MAX)}`,
      detail: `AI engines cite it in ${thirdParty.answers} of ${answers} answers about your market. A mention or a listing there puts you in front of them.`,
    });
  }

  if (percent(card.ownCitations, answers) < 10) {
    wins.push({
      title: 'Make your own pages easy to cite',
      detail: `Your site is cited in ${card.ownCitations} of ${answers} answers. Clear answers, headings that match the question and facts with sources help AI engines quote you.`,
    });
  }

  const leader = card.competitors[0];
  if (leader && leader.answers > named) {
    const rival = clip(leader.name, NAME_MAX);
    wins.push({
      title: `Close the gap on ${rival}`,
      detail: `${rival} is named in ${leader.answers} answers, ${company} in ${named}. Compare its pages with yours for the questions it wins.`,
    });
  }

  // Only when the engines differ: with one engine, or all alike, none is the weakest.
  const shares = card.engines.map((e) => percent(e.named, e.answers));
  const weakest = [...card.engines].sort(
    (a, b) => percent(a.named, a.answers) - percent(b.named, b.answers),
  )[0];
  if (weakest && Math.min(...shares) < Math.max(...shares)) {
    wins.push({
      title: `Look at what ${engineLabel(weakest.engine)} says about your market`,
      detail: `It names you in ${weakest.named} of ${weakest.answers} answers, the fewest of the ${ENGINE_COUNT[card.engines.length] ?? card.engines.length} engines.`,
    });
  }

  // A company that leads everywhere, named alike by every engine, still gets one step.
  if (!wins.length) {
    wins.push({
      title: `Keep ${company} where it is`,
      detail: `AI names you in ${named} of ${answers} answers, alike in every engine. Answers change as engines update, so check them again each month.`,
    });
  }

  return wins.slice(0, 3);
}

// ─── Page 2: the action plan ─────────────────────────────────────────────────

export interface PlanStep {
  /** What the card found, with its figures. */
  finding: string;
  /** The Ansvisor features that work on it. */
  feature: string;
  /** What the features do, from their approved Help articles. */
  lines: HelpLine[];
  /** What working on it is meant to bring. */
  aim: string;
}

/** The plan has 4 to 6 steps. */
export const PLAN_STEPS_MIN = 4;
export const PLAN_STEPS_MAX = 6;

/**
 * The action plan: one step per finding, in this order (visibility,
 * questions missed, a competitor ahead, few citations of your own site), then
 * the Action Center when there is that much to do, then AI Traffic and Chat,
 * which fit every card: four to six steps.
 */
export function actionPlan(card: ReportCardPayload): PlanStep[] {
  const { answers, named, visibility } = totals(card);
  const leader = card.competitors[0];
  const rival = leader ? clip(leader.name, NAME_MAX) : '';
  const steps: PlanStep[] = [];
  const lines = (...ids: Parameters<typeof helpLine>[0][]) =>
    ids.map((id) => helpLine(id)).filter((line): line is HelpLine => line !== null);

  steps.push({
    finding:
      leader && leader.answers > named
        ? `You appear in ${named} of ${answers} answers; ${rival} in ${leader.answers}.`
        : `You appear in ${named} of ${answers} answers (${visibility}%).`,
    feature: 'Brand Visibility',
    lines: lines('brandVisibility'),
    aim: 'Know every day how often AI answers name you, engine by engine.',
  });

  if (card.missedCount > 0) {
    steps.push({
      finding: `${card.missedCount} of ${card.questionCount} questions got no answer that names you.`,
      feature: 'Prompts and Content Editor',
      lines: lines('trackPrompts', 'contentOpportunities'),
      aim: 'A page of yours for each question you’re missing.',
    });
  }

  if (leader && leader.answers > named) {
    steps.push({
      finding: `${rival} is named ${leader.answers} times, ${leader.answers - named} more than you.`,
      feature: 'Competitors and Mentions',
      lines: lines('compareCompetitors', 'mentions'),
      aim: `See where ${rival} is named instead of you, and in what tone.`,
    });
  }

  if (percent(card.ownCitations, answers) < 10) {
    steps.push({
      finding: `AI cites your site in ${card.ownCitations} of ${answers} answers.`,
      feature: 'Citations and Site Audit',
      lines: lines('competitorGaps', 'siteAudit'),
      aim: 'Pages AI engines can cite, and the sites worth being mentioned on.',
    });
  }

  // AI Traffic and Chat close every plan; a card with little to fix keeps
  // four steps with the lead over the nearest competitor.
  const closing = 2;
  if (leader && leader.answers <= named && steps.length + closing < PLAN_STEPS_MIN) {
    steps.push({
      finding: `You’re named in ${named} answers, ${rival} in ${leader.answers}.`,
      feature: 'Competitors and Mentions',
      lines: lines('compareCompetitors', 'mentions'),
      aim: `Keep your lead: see where ${rival} gains on you.`,
    });
  }

  if (steps.length >= 3 || steps.length + closing < PLAN_STEPS_MIN) {
    steps.push({
      finding:
        steps.length >= 3
          ? `That’s ${steps.length} areas to work on at once.`
          : 'AI answers change from day to day, and so does the work to stay in them.',
      feature: 'Action Center and Agent Center',
      lines: lines('actionCenter', 'agents'),
      aim: 'One ranked list of work, and agents that take on the routine steps.',
    });
  }

  steps.push({
    finding: 'AI answers send visits that most analytics count as direct traffic.',
    feature: 'AI Traffic',
    lines: lines('aiTraffic'),
    aim: 'Your real visits from AI answers, and what they’re worth.',
  });

  steps.push({
    finding: 'You’ll have questions of your own about these answers.',
    feature: 'Chat',
    lines: lines('chat'),
    aim: 'Answers about your brand from your own Ansvisor data.',
  });

  return steps.slice(0, PLAN_STEPS_MAX);
}

/** The trial box's three first-day steps. */
export function firstDaySteps(card: ReportCardPayload): string[] {
  return [
    `Add ${clip(card.domain, 60)} as your brand: the setup wizard usually takes a few minutes.`,
    `Track this card’s ${card.questionCount} questions as prompts, in ${countryName(card.country)}.`,
    'Open the Action Center after the first run: what to do next, ranked.',
  ];
}

// ─── Page 3: outcomes ────────────────────────────────────────────────────────

export interface Goal {
  title: string;
  features: string[];
}

/** The three goals, each with the features that work toward it. */
export const OUTCOME_GOALS: readonly Goal[] = [
  {
    title: 'Maximize your visibility in AI answers',
    features: ['Brand Visibility', 'Prompts', 'Content Editor', 'Site Audit'],
  },
  {
    title: 'Grow the traffic AI answers send you',
    features: ['Citations', 'Competitors', 'AI Traffic'],
  },
  {
    title: 'Grow the revenue that comes from AI answers',
    features: ['AI Traffic conversions', 'Action Center', 'Agent Center'],
  },
];

/** The value table's rows: AI visits a month. */
export const VISIT_ROWS = [100, 1_000, 10_000] as const;

/** The plans the value table compares with. */
export const COMPARED_PLANS = ['starter', 'growth'] as const;
export type ComparedPlan = (typeof COMPARED_PLANS)[number];

export interface ValueRow {
  visits: number;
  /** What the same visits would cost a month in Google Ads, in USD. */
  monthly: number;
  yearly: number;
  /** The month's ad cost as a multiple of each plan's monthly price. */
  multiple: Record<ComparedPlan, number>;
}

export function planMonthly(plan: ComparedPlan): number {
  return PLANS[plan].pricing?.monthly ?? 0;
}

export function planYearly(plan: ComparedPlan): number {
  return PLANS[plan].pricing?.annual ?? planMonthly(plan) * 12;
}

/** The value table, or null when no keyword had a cost per click. */
export function valueRows(card: ReportCardPayload): ValueRow[] | null {
  if (!card.cpc) return null;
  const { usd } = card.cpc;
  return VISIT_ROWS.map((visits) => {
    const monthly = Math.round(visits * usd);
    const multiple = Object.fromEntries(
      COMPARED_PLANS.map((plan) => [plan, Math.round((monthly / planMonthly(plan)) * 10) / 10]),
    ) as Record<ComparedPlan, number>;
    return { visits, monthly, yearly: monthly * 12, multiple };
  });
}

/**
 * The conversion rates the revenue scenario assumes, by the site's kind: an
 * online shop's visit to an order, a B2B or app visit to a closed deal. The
 * headline is the low end. AI visits aren't assumed to convert better.
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

/** The revenue scenario, or null without a deal value. */
export function revenueRows(card: ReportCardPayload): RevenueRow[] | null {
  if (!card.dealValue) return null;
  const { amount } = card.dealValue;
  const { low, high } = conversionRange(card.siteType);
  return VISIT_ROWS.map((visits) => ({
    visits,
    low: Math.round(visits * low * amount),
    high: Math.round(visits * high * amount),
  }));
}

const settings = createTranslator({ locale: 'en', messages, namespace: 'settings' });

export interface PlanOffer {
  plan: ComparedPlan;
  name: string;
  monthly: number;
  yearly: number;
  /** What sets it apart, as the plan cards say it. */
  points: string[];
}

/**
 * Starter and Growth as the billing cards describe them: the brands and
 * prompts, the engines tracked and, for Growth, regions and Full auto.
 */
export function planOffers(): PlanOffer[] {
  const starterChat = settings.raw('planCards.starter.extrasChat') as string[];
  return COMPARED_PLANS.map((plan) => {
    const { limits, name } = PLANS[plan];
    const points = [
      `${settings('planCards.brands', { count: limits.maxBrands })} · ${settings('planCards.prompts', { count: limits.maxPrompts })}`,
      settings(`planCards.${plan}.engines`),
    ];
    if (plan === 'growth') {
      points.push(
        (settings.raw('planCards.growth.extras') as string[])[0],
        ...(settings.raw('planCards.growth.extrasChat') as string[]).filter(
          (p) => !starterChat.includes(p),
        ),
      );
    }
    return { plan, name, monthly: planMonthly(plan), yearly: planYearly(plan), points };
  });
}

/** "$1,850" or "€1,850": whole units. */
export function money(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${formatNumber(Math.round(amount))} ${currency}`;
  }
}

/** A multiple: "3.8×" under ten, "38×" from there. */
export const times = (multiple: number): string =>
  `${multiple < 10 ? multiple : formatNumber(Math.round(multiple))}×`;

/** "$1.85": a cost per click, to the cent. */
export const cents = (usd: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
