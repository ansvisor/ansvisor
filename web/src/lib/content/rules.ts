import { z } from 'zod';
import { LANGUAGES } from '@/config/prompt-options';
import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';
import { PAGE_TYPES, type PageType } from '@/lib/content/drafts';
import { lengthTarget } from '@/lib/content/editor';
import { wordsOf } from '@/lib/content/sources';

/**
 * The editor's Rules tab (Content Editor CE-009, spec §10): the rules a page
 * of its type is written to — the type's own, then the shared groups — each
 * on or off, with a value the person can change for the draft, and its
 * status read from the page as written. Rules only AI can judge (tone,
 * fairness…) say so and don't count; the agent (CE-018) checks them.
 */

export const RULE_GROUPS = ['type', 'structure', 'fanouts', 'links', 'style'] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

export type RuleKind = 'number' | 'text' | 'list' | 'switch';
export type RuleUnit =
  | 'characters'
  | 'wordsMax'
  | 'wordsMin'
  | 'fanouts'
  | 'questions'
  | 'links'
  | 'perSection'
  | 'steps';

export interface RuleDef {
  key: string;
  group: RuleGroup;
  kind: RuleKind;
  /** The default: a number, a text, a comma list; '' for a switch. */
  value: string;
  unit?: RuleUnit;
  /** How it is checked: from the page as written, by AI, or against the product feed. */
  check: 'page' | 'ai' | 'feed';
}

const SHARED_RULES: RuleDef[] = [
  {
    key: 'sentence',
    group: 'structure',
    kind: 'number',
    value: '150',
    unit: 'characters',
    check: 'page',
  },
  {
    key: 'length',
    group: 'structure',
    kind: 'number',
    value: '',
    unit: 'characters',
    check: 'page',
  },
  {
    key: 'summary',
    group: 'structure',
    kind: 'number',
    value: '50',
    unit: 'wordsMax',
    check: 'page',
  },
  {
    key: 'h2Answer',
    group: 'structure',
    kind: 'number',
    value: '60',
    unit: 'wordsMax',
    check: 'page',
  },
  { key: 'fanoutH2', group: 'fanouts', kind: 'number', value: '4', unit: 'fanouts', check: 'page' },
  { key: 'faq', group: 'fanouts', kind: 'number', value: '5', unit: 'questions', check: 'page' },
  {
    key: 'fanoutFaq',
    group: 'fanouts',
    kind: 'number',
    value: '3',
    unit: 'questions',
    check: 'page',
  },
  { key: 'keywords', group: 'fanouts', kind: 'list', value: '', check: 'page' },
  {
    key: 'internalLinks',
    group: 'links',
    kind: 'number',
    value: '3',
    unit: 'links',
    check: 'page',
  },
  {
    key: 'outboundLinks',
    group: 'links',
    kind: 'number',
    value: '2',
    unit: 'links',
    check: 'page',
  },
  { key: 'datedPoint', group: 'links', kind: 'switch', value: '', check: 'page' },
  { key: 'citeInline', group: 'links', kind: 'switch', value: '', check: 'page' },
  { key: 'aiTraces', group: 'style', kind: 'switch', value: '', check: 'page' },
  {
    key: 'bannedWords',
    group: 'style',
    kind: 'list',
    value: 'seamless, leverage, robust',
    check: 'page',
  },
  { key: 'tone', group: 'style', kind: 'text', value: 'Clear, confident, no hype', check: 'ai' },
  { key: 'language', group: 'style', kind: 'text', value: 'English (US)', check: 'ai' },
];

/** Each page type's own rules, above the shared ones (spec §10); a blog post has none. */
const TYPE_RULES: Partial<Record<PageType, RuleDef[]>> = {
  feature_page: [
    { key: 'comparisonTable', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'whoFor', group: 'type', kind: 'text', value: '', check: 'ai' },
    {
      key: 'proofPerSection',
      group: 'type',
      kind: 'number',
      value: '1',
      unit: 'perSection',
      check: 'page',
    },
  ],
  solution_page: [
    { key: 'industryNamed', group: 'type', kind: 'switch', value: '', check: 'ai' },
    {
      key: 'useCaseSteps',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'steps',
      check: 'page',
    },
  ],
  comparison: [
    { key: 'sideBySide', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'fairness', group: 'type', kind: 'switch', value: '', check: 'ai' },
  ],
  product_page: [
    { key: 'specsTable', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'feedMatch', group: 'type', kind: 'switch', value: '', check: 'feed' },
    {
      key: 'fitQuestions',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
    { key: 'first40Words', group: 'type', kind: 'switch', value: '', check: 'ai' },
  ],
  category_page: [
    {
      key: 'introText',
      group: 'type',
      kind: 'number',
      value: '120',
      unit: 'wordsMin',
      check: 'page',
    },
    {
      key: 'buyingFaq',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
  ],
  destination_page: [
    { key: 'currentPrices', group: 'type', kind: 'switch', value: '', check: 'ai' },
    { key: 'bestTime', group: 'type', kind: 'switch', value: '', check: 'page' },
  ],
  guide: [
    {
      key: 'howToSteps',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'steps',
      check: 'page',
    },
  ],
  definition: [
    {
      key: 'definitionFirst',
      group: 'type',
      kind: 'number',
      value: '60',
      unit: 'wordsMax',
      check: 'page',
    },
    { key: 'examplesSection', group: 'type', kind: 'switch', value: '', check: 'page' },
  ],
  alternatives: [
    { key: 'sideBySide', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'fairness', group: 'type', kind: 'switch', value: '', check: 'ai' },
  ],
  collection_page: [
    {
      key: 'introText',
      group: 'type',
      kind: 'number',
      value: '120',
      unit: 'wordsMin',
      check: 'page',
    },
    {
      key: 'buyingFaq',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
  ],
  sizing_guide: [
    { key: 'sizeChart', group: 'type', kind: 'switch', value: '', check: 'page' },
    {
      key: 'measureSteps',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'steps',
      check: 'page',
    },
    {
      key: 'fitQuestions',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
  ],
};

/** The rules of a set: the type's own, then the shared groups, with the type's length. */
/**
 * The Language rule's value for the brand's language (brands.language, as
 * the brief and the agent write in): its name, US English for English or
 * none.
 */
export function languageRuleValue(code: string | null | undefined): string {
  const label = code && code !== 'en' ? LANGUAGES.find((l) => l.code === code)?.label : undefined;
  return label ? label.replace(/\s*\([^)]*\)$/, '') : 'English (US)';
}

export function ruleSet(
  pageType: PageType | null,
  defaults: { keywords?: string[]; language?: string | null } = {},
): RuleDef[] {
  const own = (pageType && TYPE_RULES[pageType]) || [];
  return [
    ...own,
    ...SHARED_RULES.map((rule) => {
      if (rule.key === 'length') return { ...rule, value: String(lengthTarget(pageType)) };
      if (rule.key === 'language') return { ...rule, value: languageRuleValue(defaults.language) };
      if (rule.key === 'keywords' && defaults.keywords?.length) {
        return { ...rule, value: defaults.keywords.join(', ') };
      }
      return rule;
    }),
  ];
}

/** Per rule: whether it is on, and the value used. */
const overridesSchema = z
  .record(
    z.string().max(40),
    z.object({ on: z.boolean().optional(), value: z.string().max(500).optional() }),
  )
  .refine((o) => Object.keys(o).length <= 60);

/** A rule written in the person's own words ("Your text rules"). */
export const MAX_TEXT_RULES = 50;
export const MAX_TEXT_RULE_LENGTH = 300;
export const textRuleSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(MAX_TEXT_RULE_LENGTH),
  on: z.boolean(),
});
export type TextRule = z.infer<typeof textRuleSchema>;

/** The draft's choices on its rules (content_drafts.rules, 00213). */
export const draftRulesSchema = z.object({
  /** The page type whose set applies; null follows the draft's type. */
  set: z.enum(PAGE_TYPES).nullable(),
  /**
   * The set the draft started from: Ansvisor's default, or the workspace's
   * My rules (00214). Null until the person changes something: the
   * workspace's My rules for the type apply, if it has them.
   */
  source: z.enum(['default', 'mine']).nullable().default(null),
  overrides: overridesSchema,
  textRules: z.array(textRuleSchema).max(MAX_TEXT_RULES).default([]),
});
export type DraftRules = z.infer<typeof draftRulesSchema>;
/** As saved: the source and text rules may be left out (rules from before 00214 have neither). */
export type DraftRulesInput = z.input<typeof draftRulesSchema>;
export const NO_DRAFT_RULES: DraftRules = {
  set: null,
  source: null,
  overrides: {},
  textRules: [],
};

/** A workspace's My rules for one page type (content_rule_sets, 00214). */
export const savedRuleSetSchema = z.object({
  overrides: overridesSchema,
  textRules: z.array(textRuleSchema).max(MAX_TEXT_RULES),
});
export type SavedRuleSet = z.infer<typeof savedRuleSetSchema>;

/**
 * The database's size checks, in bytes of the JSON as stored: a draft's
 * rules (00213), and a set's overrides and text rules (00214). The zod
 * limits count characters, and text outside Latin script takes 2–4 bytes
 * each, so a save is checked against these first.
 */
export const MAX_DRAFT_RULES_BYTES = 32_768;
export const MAX_SET_OVERRIDES_BYTES = 16_384;
export const MAX_SET_TEXT_RULES_BYTES = 32_768;

/**
 * At least the bytes a value takes as jsonb text: its UTF-8 JSON, plus the
 * space jsonb writes after each ':' and ',' (counted for every one, so the
 * size errs high).
 */
export function storedBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length + (json.match(/[:,]/g)?.length ?? 0);
}

/** Whether a draft's rules fit the database's check. */
export function draftRulesFit(rules: DraftRules): boolean {
  return storedBytes(rules) <= MAX_DRAFT_RULES_BYTES;
}

/** Whether a set fits the database's checks. */
export function ruleSetFits(set: SavedRuleSet): boolean {
  return (
    storedBytes(set.overrides) <= MAX_SET_OVERRIDES_BYTES &&
    storedBytes(set.textRules) <= MAX_SET_TEXT_RULES_BYTES
  );
}

/**
 * The choices in effect: the draft's own; or, for a draft no one has set
 * rules on yet, the workspace's My rules for the set's type, as a template.
 */
export function effectiveRules(rules: DraftRules, mine: SavedRuleSet | undefined): DraftRules {
  const untouched =
    rules.source === null && !Object.keys(rules.overrides).length && !rules.textRules.length;
  if (untouched && mine) {
    return { ...rules, source: 'mine', overrides: mine.overrides, textRules: mine.textRules };
  }
  return rules;
}

/**
 * Paste many: one rule per line, bullets and numbering taken off ("- ",
 * "• ", "1. ", "2) "), empty lines dropped, each cut to the limit.
 */
export function splitRules(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map((line) => line.slice(0, MAX_TEXT_RULE_LENGTH));
}

/** How a text rule is checked: a number makes it a number check; anything else, AI. */
export function textRuleCheck(text: string): 'numberCheck' | 'aiCheck' {
  return /\d/.test(text) ? 'numberCheck' : 'aiCheck';
}

export interface ActiveRule extends RuleDef {
  on: boolean;
  /** The value in effect: the draft's, else the set's. */
  current: string;
  changed: boolean;
}

export function activeRules(defs: RuleDef[], rules: Pick<DraftRules, 'overrides'>): ActiveRule[] {
  return defs.map((def) => {
    const override = rules.overrides[def.key];
    const current = override?.value ?? def.value;
    return {
      ...def,
      on: override?.on ?? true,
      current,
      changed: (override?.on !== undefined && override.on !== true) || current !== def.value,
    };
  });
}

/** The lengths a brief is built for (content-brief.js BRIEF_LENGTH_MIN/MAX), in characters. */
export const RULE_LENGTH_MIN = 100;
export const RULE_LENGTH_MAX = 50_000;

/**
 * The page length the rules ask for: the Length rule's value while it is on,
 * within the range Rebuild outline builds for.
 */
export function ruleLength(rules: ActiveRule[], pageType: PageType | null): number {
  const rule = rules.find((r) => r.key === 'length');
  const value = rule?.on ? Number(rule.current) : NaN;
  if (!Number.isFinite(value) || value <= 0) return lengthTarget(pageType);
  return Math.min(RULE_LENGTH_MAX, Math.max(RULE_LENGTH_MIN, value));
}

// ─── The page as written ────────────────────────────────────────────────────

export interface PageBlock {
  tag: string;
  text: string;
  words: number;
  /** Links in the block, as written. */
  links: string[];
}

export interface PageRead {
  blocks: PageBlock[];
  text: string;
  /** The editor's character count, as the toolbar shows it. */
  characters: number;
}

const BLOCK_TAGS = 'h1, h2, h3, p, li, table, ol, ul, blockquote';

/** Reads the page's blocks in order, each list item and table once. */
export function readPage(html: string, characters: number): PageRead {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: PageBlock[] = [];
  for (const el of doc.body.querySelectorAll(BLOCK_TAGS)) {
    const tag = el.tagName.toLowerCase();
    // A paragraph inside a list item or a cell is part of that block.
    if (tag === 'p' && el.closest('li, td, th, blockquote')) continue;
    if ((tag === 'ol' || tag === 'ul') && el.closest('li')) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    blocks.push({
      tag:
        tag === 'ol' || tag === 'ul' ? `${tag}:${el.querySelectorAll(':scope > li').length}` : tag,
      text,
      words: countWords(text),
      links: [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
    });
  }
  return {
    blocks,
    text: blocks
      .filter((b) => !b.tag.startsWith('ol') && !b.tag.startsWith('ul'))
      .map((b) => b.text)
      .join(' '),
    characters,
  };
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

const isHeading = (b: PageBlock) => b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3';
const isText = (b: PageBlock) => b.tag === 'p' || b.tag === 'li';
const isQuestion = (b: PageBlock) => b.text.trim().endsWith('?');

// ─── Checks ─────────────────────────────────────────────────────────────────

/** A rule's status: met, not met (with what's missing), or one the page can't say. */
export type RuleStatus =
  | { state: 'ok' }
  | { state: 'bad'; code: 'over' | 'found'; count: number }
  | { state: 'bad'; code: 'partOf'; count: number; of: number }
  | { state: 'bad'; code: 'current'; count: number }
  | { state: 'bad'; code: 'words'; count: number }
  | { state: 'bad'; code: 'missing' | 'noH2' | 'needsFaq' | 'notSet' }
  | { state: 'info'; code: 'aiCheck' | 'needsFeed' | 'noFanouts' | 'addKeywords' };

export interface RuleContext {
  brandDomains: string[];
  competitorDomains: string[];
  /** The fan-outs the draft keeps, the most searched first. */
  fanouts: string[];
}

/** Phrases that read as machine-written (spec §10, "Remove AI traces"). */
export const AI_TRACES = [
  'delve',
  "in today's fast-paced world",
  'in today’s fast-paced world',
  'it is important to note',
  "it's important to note",
  'navigate the complexities',
  'unlock the power',
  'a testament to',
  'in the ever-evolving',
  'game-changer',
  'not only',
];

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function count(text: string, phrase: string): number {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    text.toLowerCase().match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu'))
      ?.length ?? 0
  );
}

/** The machine-written phrases the page has, each once: what "Remove AI traces" counts. */
export function aiTracesFound(text: string): string[] {
  return [
    ...new Set(
      AI_TRACES.filter((phrase) => count(text, phrase) > 0).map((p) => p.replace('’', "'")),
    ),
  ];
}

/** A link's host, or null for one on the page's own site (a path or an anchor). */
function linkHost(href: string): string | null {
  if (!/^https?:\/\//i.test(href)) return null;
  return normalizeDomain(href) || null;
}

/** Whether a fan-out's words are carried by a text, as the Sources tab reads it. */
function carries(fanout: string, text: string): boolean {
  const words = [...new Set(wordsOf(fanout))];
  if (!words.length) return false;
  const have = new Set(wordsOf(text));
  return words.filter((w) => have.has(w)).length / words.length >= 0.75;
}

/** The FAQ's questions: the blocks after an "FAQ" heading, up to the next H2, that ask one. */
function faqQuestions(blocks: PageBlock[]): string[] | null {
  const start = blocks.findIndex(
    (b) => (b.tag === 'h2' || b.tag === 'h3') && /\b(faq|faqs|frequently asked)\b/i.test(b.text),
  );
  if (start < 0) return null;
  const level = blocks[start].tag;
  const questions: string[] = [];
  for (const block of blocks.slice(start + 1)) {
    if (block.tag === 'h2' || (level === 'h3' && block.tag === 'h3' && !isQuestion(block))) break;
    if ((block.tag === 'h3' || isText(block)) && isQuestion(block)) questions.push(block.text);
  }
  return questions;
}

const atLeast = (have: number, want: number): RuleStatus =>
  have >= want ? { state: 'ok' } : { state: 'bad', code: 'partOf', count: have, of: want };

/** Checks one rule against the page as written. */
export function checkRule(rule: ActiveRule, page: PageRead, ctx: RuleContext): RuleStatus {
  if (rule.check === 'feed') return { state: 'info', code: 'needsFeed' };
  if (rule.key === 'whoFor' && !rule.current.trim()) return { state: 'bad', code: 'notSet' };
  if (rule.check === 'ai') return { state: 'info', code: 'aiCheck' };

  const n = Math.max(0, Math.floor(Number(rule.current) || 0));
  const { blocks } = page;
  const h1 = blocks.findIndex((b) => b.tag === 'h1');
  const firstH2 = blocks.findIndex((b) => b.tag === 'h2');
  const summary = blocks
    .slice(h1 + 1, firstH2 < 0 ? undefined : firstH2)
    .find((b) => b.tag === 'p');
  const own = ctx.brandDomains.map(normalizeDomain);
  const competitors = ctx.competitorDomains.map(normalizeDomain);
  const links = blocks.flatMap((b) => (isText(b) ? b.links : []));
  const outbound = (href: string) => {
    const host = linkHost(href);
    if (!host) return false;
    const kind = classifyDomain(host, { brandDomains: own, competitorDomains: competitors });
    return kind !== 'you' && kind !== 'competitor';
  };

  switch (rule.key) {
    case 'sentence': {
      const over = blocks
        .filter(isText)
        .flatMap((b) => b.text.split(/(?<=[.!?])\s+/))
        .filter((s) => s.length > n).length;
      return over ? { state: 'bad', code: 'over', count: over } : { state: 'ok' };
    }
    case 'length':
      return page.characters >= n
        ? { state: 'ok' }
        : { state: 'bad', code: 'current', count: page.characters };
    case 'summary':
      if (!summary || !summary.words) return { state: 'bad', code: 'missing' };
      return summary.words <= n
        ? { state: 'ok' }
        : { state: 'bad', code: 'words', count: summary.words };
    case 'h2Answer': {
      const h2s = blocks.flatMap((b, i) => (b.tag === 'h2' ? [i] : []));
      if (!h2s.length) return { state: 'bad', code: 'noH2' };
      const answered = h2s.filter((i) => {
        const next = blocks[i + 1];
        return next?.tag === 'p' && next.words > 0 && next.words <= n;
      }).length;
      return atLeast(answered, h2s.length);
    }
    case 'fanoutH2': {
      const top = ctx.fanouts.slice(0, n);
      if (!top.length) return { state: 'info', code: 'noFanouts' };
      const h2s = blocks.filter((b) => b.tag === 'h2');
      return atLeast(top.filter((f) => h2s.some((h) => carries(f, h.text))).length, top.length);
    }
    case 'faq':
    case 'buyingFaq': {
      const questions = faqQuestions(blocks);
      if (!questions) return { state: 'bad', code: 'missing' };
      return atLeast(questions.length, n);
    }
    case 'fanoutFaq': {
      const questions = faqQuestions(blocks);
      if (!questions) return { state: 'bad', code: 'needsFaq' };
      if (!ctx.fanouts.length) return { state: 'info', code: 'noFanouts' };
      const used = questions.filter((q) => ctx.fanouts.some((f) => carries(f, q))).length;
      return atLeast(used, n);
    }
    case 'keywords': {
      const wanted = list(rule.current);
      if (!wanted.length) return { state: 'info', code: 'addKeywords' };
      return atLeast(wanted.filter((k) => count(page.text, k) > 0).length, wanted.length);
    }
    case 'internalLinks':
      return atLeast(
        links.filter((href) => {
          const host = linkHost(href);
          return host
            ? classifyDomain(host, { brandDomains: own, competitorDomains: [] }) === 'you'
            : !href.startsWith('#') && !/^[a-z]+:/i.test(href);
        }).length,
        n,
      );
    case 'outboundLinks':
      return atLeast(links.filter(outbound).length, n);
    case 'datedPoint': {
      const first100 = page.text.split(/\s+/).slice(0, 100).join(' ');
      return /\b(19|20)\d{2}\b/.test(first100)
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    }
    case 'citeInline':
      return links.some(outbound) ? { state: 'ok' } : { state: 'bad', code: 'missing' };
    case 'aiTraces': {
      const found = AI_TRACES.reduce((sum, phrase) => sum + count(page.text, phrase), 0);
      return found ? { state: 'bad', code: 'found', count: found } : { state: 'ok' };
    }
    case 'bannedWords': {
      const found = list(rule.current).reduce((sum, word) => sum + count(page.text, word), 0);
      return found ? { state: 'bad', code: 'found', count: found } : { state: 'ok' };
    }
    case 'comparisonTable':
    case 'sideBySide':
    case 'specsTable':
    case 'sizeChart':
      return blocks.some((b) => b.tag === 'table')
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    case 'proofPerSection': {
      const sections = splitSections(blocks);
      if (!sections.length) return { state: 'bad', code: 'noH2' };
      const proven = sections.filter(
        (s) =>
          s.filter((b) => b.tag === 'blockquote' || (isText(b) && /\d/.test(b.text))).length >= n,
      ).length;
      return atLeast(proven, sections.length);
    }
    case 'useCaseSteps':
    case 'howToSteps':
    case 'measureSteps': {
      const most = Math.max(
        0,
        ...blocks.filter((b) => b.tag.startsWith('ol:')).map((b) => Number(b.tag.slice(3))),
      );
      return most ? atLeast(most, n) : { state: 'bad', code: 'missing' };
    }
    case 'fitQuestions':
      return atLeast(
        blocks.filter((b) => isQuestion(b) && /\b(fit|fits|size|sizes|sizing)\b/i.test(b.text))
          .length,
        n,
      );
    case 'introText': {
      const words = blocks
        .slice(h1 + 1, firstH2 < 0 ? undefined : firstH2)
        .filter(isText)
        .reduce((sum, b) => sum + b.words, 0);
      return words >= n ? { state: 'ok' } : { state: 'bad', code: 'current', count: words };
    }
    case 'definitionFirst':
      // The term defined at once: "X is …" in a short first paragraph.
      if (!summary || !summary.words) return { state: 'bad', code: 'missing' };
      if (!/\b(is|are|refers to|means)\b/i.test(summary.text)) {
        return { state: 'bad', code: 'missing' };
      }
      return summary.words <= n
        ? { state: 'ok' }
        : { state: 'bad', code: 'words', count: summary.words };
    case 'examplesSection':
      return blocks.some((b) => isHeading(b) && /\bexamples?\b/i.test(b.text))
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    case 'bestTime':
      return summary && /\bbest time\b/i.test(summary.text)
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    default:
      return { state: 'info', code: 'aiCheck' };
  }
}

/** The blocks under each H2, up to the next. */
function splitSections(blocks: PageBlock[]): PageBlock[][] {
  const sections: PageBlock[][] = [];
  for (const block of blocks) {
    if (block.tag === 'h2') sections.push([]);
    else if (sections.length && !isHeading(block)) sections[sections.length - 1].push(block);
  }
  return sections;
}

/** How many of the rules in effect are met: off rules and ones the page can't say don't count. */
export function rulesMet(statuses: { rule: ActiveRule; status: RuleStatus }[]): {
  met: number;
  total: number;
} {
  const counted = statuses.filter((s) => s.rule.on && s.status.state !== 'info');
  return { met: counted.filter((s) => s.status.state === 'ok').length, total: counted.length };
}
