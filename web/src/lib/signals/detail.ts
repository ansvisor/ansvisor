import type { Signal } from './map';
import { locationName, platformName } from './names';
import { isLibrarySignalKind, type SignalCategory, type SignalKind } from './registry';

/**
 * What a signal's detail says, as data (AC-001): where it happened, what
 * changed, and what it rests on. The drawer renders it and the MCP
 * list_signals tool returns it, so both describe a signal the same way.
 *
 * Every number gets a metric, a role and a period, because the row's three
 * value columns mean different things per detector: for a source domain
 * "0 → 251 +167" is answers naming you, answers citing it and answers naming
 * only competitors, not a before and an after. A field the spec asks for
 * but no detector records yet is listed with no value, so the panel says
 * "Not available" rather than hiding the question.
 */

// ─── What changed ───────────────────────────────────────────────────────────

export type SignalMetric =
  /** Share of tracked prompts where the brand appears. */
  | 'visibility_rate'
  /** Share of answers naming the brand (or the competitor in `subject`). */
  | 'mention_rate'
  /** Share of a topic's prompts where the brand appears. */
  | 'coverage'
  /** Answers naming the brand, or the competitor in `subject`. */
  | 'mentions'
  /** Answers citing the brand, or the competitor in `subject`. */
  | 'citation_answers'
  /** Answers citing a source domain. */
  | 'answers_citing'
  | 'visibility_score'
  | 'ai_sessions'
  | 'search_clicks'
  | 'sessions'
  | 'engagement_rank'
  /** How many things a grouped finding covers. */
  | 'prompts'
  | 'pages'
  | 'queries'
  /** Result days on which an answer cited the brand. */
  | 'cited_days';

export type SignalUnit = 'percent' | 'points' | 'count' | 'rank';

export const METRIC_UNITS: Record<SignalMetric, SignalUnit> = {
  visibility_rate: 'percent',
  mention_rate: 'percent',
  coverage: 'percent',
  mentions: 'count',
  citation_answers: 'count',
  answers_citing: 'count',
  visibility_score: 'points',
  ai_sessions: 'count',
  search_clicks: 'count',
  sessions: 'count',
  engagement_rank: 'rank',
  prompts: 'count',
  pages: 'count',
  queries: 'count',
  cited_days: 'count',
};

/**
 * Whose or when a figure is. `before`/`after` are the two windows of a
 * week-over-week change; the others compare things inside one window, with
 * `subject` naming the competitor, platform or location.
 */
export type FigureRole =
  | 'before'
  | 'after'
  /** The earlier result days of a window, and its latest few. */
  | 'earlier'
  | 'latest'
  | 'change'
  | 'you'
  | 'competitor'
  | 'best'
  | 'this'
  | 'total'
  | 'naming_you'
  | 'competitors_only'
  | 'now';

export interface SignalFigure {
  metric: SignalMetric;
  role: FigureRole;
  value: number;
  /** The competitor's name, or the platform slug or location code compared. */
  subject?: string;
  subjectType?: 'competitor' | 'platform' | 'location';
  /** Out of how many, for a count of days: 9 of 11. */
  of?: number;
}

/** The window the figures cover. The detectors all read 7-day windows. */
export type ChangePeriod = 'week_over_week' | 'last_7_days' | 'last_14_days' | 'latest';

export interface SignalChange {
  period: ChangePeriod;
  figures: SignalFigure[];
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** Kinds whose two values are the previous and the last 7 days of one metric. */
const WEEK_OVER_WEEK: Partial<Record<SignalKind, SignalMetric>> = {
  sharp_drop: 'visibility_rate',
  visibility_slipping: 'visibility_rate',
  platform_slipping: 'mention_rate',
  platform_drop: 'mention_rate',
  topic_gap: 'coverage',
  topic_uncovered: 'coverage',
  topic_slipping: 'coverage',
  topic_drop: 'coverage',
  competitor_momentum: 'mentions',
  competitor_surge: 'mention_rate',
  ai_traffic_drop: 'ai_sessions',
  visibility_traffic_loss: 'ai_sessions',
  cross_channel_risk: 'ai_sessions',
};

const COUNTED: Record<string, SignalMetric> = {
  prompts: 'prompts',
  pages: 'pages',
  queries: 'queries',
};

/** The figures behind a signal, or null when its row records none. */
export function signalChange(signal: Signal): SignalChange | null {
  const p = signal.payload ?? {};
  const prev = signal.previousValue;
  const cur = signal.currentValue;
  const change = signal.changeValue;
  const competitor = str(p, 'competitorName') || undefined;

  const overTime = WEEK_OVER_WEEK[signal.kind];
  if (overTime && prev !== null && cur !== null) {
    // A competitor's own trend names the competitor; the brand's doesn't.
    const competitorOnly = overTime === 'mentions' || overTime === 'mention_rate';
    const about =
      competitor && competitorOnly
        ? { subject: competitor, subjectType: 'competitor' as const }
        : {};
    const figures: SignalFigure[] = [
      { metric: overTime, role: 'before', value: prev, ...about },
      { metric: overTime, role: 'after', value: cur, ...about },
    ];
    // The cross-channel findings say what fell beside the AI sessions.
    if (signal.kind === 'cross_channel_risk') {
      figures.push(
        { metric: 'search_clicks', role: 'before', value: Number(p.clicksBefore ?? 0) },
        { metric: 'search_clicks', role: 'after', value: Number(p.clicksNow ?? 0) },
      );
    }
    if (signal.kind === 'visibility_traffic_loss') {
      figures.push(
        { metric: 'mentions', role: 'before', value: Number(p.mentionsBefore ?? 0) },
        { metric: 'mentions', role: 'after', value: Number(p.mentionsNow ?? 0) },
      );
    }
    return { period: 'week_over_week', figures };
  }

  switch (signal.kind) {
    case 'lost_citations': {
      // Recorded with the evidence (server signals/lost-citation-evidence.js):
      // cited on `citedDays` of the `days` earlier result days, on none of
      // the latest `quietDays`.
      const { citedDays, days, quietDays } = p;
      if (typeof citedDays !== 'number' || typeof days !== 'number') return null;
      return {
        period: 'last_14_days',
        figures: [
          { metric: 'cited_days', role: 'earlier', value: citedDays, of: days },
          {
            metric: 'cited_days',
            role: 'latest',
            value: 0,
            of: typeof quietDays === 'number' ? quietDays : 0,
          },
        ],
      };
    }
    case 'platform_gap':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'visibility_rate',
            role: 'best',
            value: prev,
            subject: str(p, 'bestPlatform'),
            subjectType: 'platform',
          },
          {
            metric: 'visibility_rate',
            role: 'this',
            value: cur,
            subject: str(p, 'platform'),
            subjectType: 'platform',
          },
        ],
      };
    case 'country_gap':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'mention_rate',
            role: 'best',
            value: prev,
            subject: str(p, 'bestRegion'),
            subjectType: 'location',
          },
          {
            metric: 'mention_rate',
            role: 'this',
            value: cur,
            subject: str(p, 'region'),
            subjectType: 'location',
          },
        ],
      };
    case 'competitor_leads':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'mentions',
            role: 'competitor',
            value: cur,
            subject: competitor,
            subjectType: 'competitor',
          },
          { metric: 'mentions', role: 'you', value: prev },
        ],
      };
    case 'competitor_citation_gap':
      if (prev === null || cur === null) return null;
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'citation_answers',
            role: 'competitor',
            value: prev,
            subject: competitor,
            subjectType: 'competitor',
          },
          { metric: 'citation_answers', role: 'you', value: cur },
        ],
      };
    case 'competitor_crossed':
    case 'competitor_overtaken':
      return {
        period: 'last_7_days',
        figures: [
          {
            metric: 'mention_rate',
            role: 'competitor',
            value: Number(p.competitorRate ?? 0),
            subject: competitor,
            subjectType: 'competitor',
          },
          { metric: 'mention_rate', role: 'you', value: Number(p.brandRate ?? 0) },
        ],
      };
    case 'prompt_gain':
      if (change === null) return null;
      return {
        period: 'week_over_week',
        figures: [{ metric: 'visibility_score', role: 'change', value: change }],
      };
    case 'page_opportunity': {
      const figures: SignalFigure[] = [];
      if (typeof p.valueRank === 'number') {
        figures.push({ metric: 'engagement_rank', role: 'now', value: p.valueRank });
      }
      if (cur !== null) figures.push({ metric: 'sessions', role: 'now', value: cur });
      return figures.length ? { period: 'latest', figures } : null;
    }
    case 'uncited_mentions':
      return cur === null
        ? null
        : { period: 'last_7_days', figures: [{ metric: 'prompts', role: 'total', value: cur }] };
    case 'audit_low_score':
      return cur === null
        ? null
        : { period: 'latest', figures: [{ metric: 'pages', role: 'total', value: cur }] };
  }

  if (!isLibrarySignalKind(signal.kind)) return null;
  const entity = str(p, 'entity');
  // Answers citing a source domain: all of them, those naming the brand, and
  // those naming only competitors (ae_citation_sources).
  if (entity === 'sources' && cur !== null) {
    return {
      period: 'last_7_days',
      figures: [
        { metric: 'answers_citing', role: 'total', value: cur },
        { metric: 'answers_citing', role: 'naming_you', value: prev ?? 0 },
        { metric: 'answers_citing', role: 'competitors_only', value: change ?? 0 },
      ],
    };
  }
  // A competitor's topic finding counts the topic's tracked prompts.
  if (entity === 'topics' && prev === null && cur !== null) {
    return { period: 'last_7_days', figures: [{ metric: 'prompts', role: 'total', value: cur }] };
  }
  const counted = COUNTED[entity];
  if (counted && cur !== null) {
    return { period: 'last_7_days', figures: [{ metric: counted, role: 'total', value: cur }] };
  }
  return null;
}

// ─── Where ──────────────────────────────────────────────────────────────────

export type WhereFieldKey =
  | 'scope'
  | 'prompt'
  | 'prompts'
  | 'topic'
  | 'platforms'
  | 'locations'
  /** Where the signal's prompts are tracked, which can be wider than where it happened. */
  | 'trackedOn'
  | 'trackedIn'
  | 'domain'
  | 'competitor'
  | 'url'
  | 'pages'
  | 'queries'
  | 'engagementRank'
  | 'lostUrl'
  | 'citedNow'
  | 'exampleUrls'
  | 'competitorsNamed'
  | 'bestPage'
  | 'position'
  | 'sentiment'
  | 'excerpt'
  | 'aiReferrals'
  | 'citablePrompts'
  | 'issue'
  | 'crawlers'
  | 'evidence'
  | 'competitorPositions'
  | 'winningSources';

export type WhereValue =
  | { type: 'text'; text: string }
  | { type: 'scope'; scope: 'all_prompts' | 'site' | 'topic' | 'platform' | 'location' | 'prompt' }
  | { type: 'prompt'; id: string | null; text: string }
  | { type: 'prompts'; items: { id: string | null; text: string }[]; total: number }
  | { type: 'list'; items: string[]; total: number }
  | { type: 'platforms'; slugs: readonly string[] }
  /** Every tracked platform: a finding about the whole brand or a location. */
  | { type: 'all_platforms' }
  /** Cited pages: the brand's lost ones, or those cited in their place. */
  | { type: 'citations'; items: CitedPage[] }
  /** A competitor's position against the brand's, per prompt and platform. */
  | { type: 'positions'; competitor: string; items: PromptPosition[] }
  /** Domains cited in the answers a competitor wins. */
  | { type: 'sources'; items: WinningSource[] }
  | { type: 'locations'; codes: readonly string[] }
  | { type: 'number'; value: number };

export interface CitedPage {
  url: string;
  /** Its position among the answer's citations, 1 first. */
  position: number | null;
  lastCitedAt?: string;
  answers?: number;
  /** Of how many answers read back: a sample of the quiet days' answers. */
  answersRead?: number;
}

function citedPages(value: unknown): CitedPage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.url === 'string')
    .map((v) => ({
      url: v.url as string,
      position: typeof v.position === 'number' ? v.position : null,
      ...(typeof v.lastCitedAt === 'string' ? { lastCitedAt: v.lastCitedAt } : {}),
      ...(typeof v.answers === 'number' ? { answers: v.answers } : {}),
      ...(typeof v.answersRead === 'number' ? { answersRead: v.answersRead } : {}),
    }));
}

/** Positions are averages over the week's answers (1 = named first); null when not named. */
export interface PromptPosition {
  promptId: string;
  promptText: string;
  platform: string;
  competitor: { now: number | null; before: number | null };
  you: { now: number | null; before: number | null };
}

export interface WinningSource {
  domain: string;
  /** Answers it is cited in, of the answers read that the competitor wins. */
  answers: number;
  answersRead: number;
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function promptPositions(value: unknown): PromptPosition[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.promptId === 'string')
    .map((v) => {
      const competitor = (v.competitor ?? {}) as Record<string, unknown>;
      const you = (v.you ?? {}) as Record<string, unknown>;
      return {
        promptId: v.promptId as string,
        promptText: typeof v.promptText === 'string' ? v.promptText : '',
        platform: typeof v.platform === 'string' ? v.platform : '',
        competitor: { now: num(competitor.now), before: num(competitor.before) },
        you: { now: num(you.now), before: num(you.before) },
      };
    });
}

function winningSourcesOf(value: unknown): WinningSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v?.domain === 'string')
    .map((v) => ({
      domain: v.domain as string,
      answers: num(v.answers) ?? 0,
      answersRead: num(v.answersRead) ?? 0,
    }));
}

export interface WhereField {
  key: WhereFieldKey;
  /** Null when no detector records it yet: the panel says "Not available". */
  value: WhereValue | null;
}

// Signals about one of the brand's own citations going away.
const CITATION_LOSS: readonly SignalKind[] = [
  'lost_citations',
  'citation_at_risk',
  'page_citation_slipping',
  'owned_page_citation_lost',
];

// What the spec asks each panel to answer, per category (AC-001's table).
// The fields a signal's data can fill come first in each list.
const LAYOUT: Record<SignalCategory, WhereFieldKey[]> = {
  visibility: ['scope', 'prompt', 'prompts', 'topic', 'platforms', 'locations', 'queries'],
  citation: [
    'domain',
    'prompt',
    'prompts',
    'topic',
    'platforms',
    'locations',
    'url',
    'exampleUrls',
    'competitorsNamed',
    'bestPage',
  ],
  mention: ['prompt', 'prompts', 'platforms', 'locations', 'position', 'sentiment', 'excerpt'],
  traffic: ['scope', 'url', 'pages', 'queries', 'engagementRank', 'aiReferrals', 'citablePrompts'],
  technical: ['url', 'pages', 'issue', 'crawlers', 'evidence'],
  competitor: [
    'competitor',
    'domain',
    'topic',
    'prompts',
    'queries',
    'platforms',
    'competitorPositions',
    'winningSources',
  ],
};

// A first citation is a gain: the page and the prompt, not who replaced it.
const FIRST_CITATION_LAYOUT: WhereFieldKey[] = ['url', 'prompt', 'platforms', 'locations'];

const CITATION_LOSS_LAYOUT: WhereFieldKey[] = [
  'prompt',
  'prompts',
  'topic',
  'pages',
  'platforms',
  'locations',
  'lostUrl',
  'citedNow',
];

// A field that only some signals of a category have is shown when it has a
// value; the spec's required fields are shown either way.
const OPTIONAL: ReadonlySet<WhereFieldKey> = new Set([
  'scope',
  'prompt',
  'prompts',
  'topic',
  'domain',
  'url',
  'pages',
  'queries',
  'locations',
  'engagementRank',
  'issue',
]);

interface Target {
  id?: unknown;
  label?: unknown;
  competitor?: unknown;
  checks?: unknown;
  page?: unknown;
}

function targetsOf(signal: Signal): Target[] {
  const targets = signal.payload?.targets;
  return Array.isArray(targets) ? (targets as Target[]) : [];
}

function label(target: Target): string {
  if (typeof target.label === 'string' && target.label) return target.label;
  if (typeof target.page === 'string') return target.page;
  return typeof target.id === 'string' ? target.id : '';
}

function fieldValue(signal: Signal, key: WhereFieldKey): WhereValue | null {
  const p = signal.payload ?? {};
  const entity = str(p, 'entity');
  const targets = targetsOf(signal);
  // A grouped finding names the first 50 of its targets; the count is all.
  const total = Math.max(targets.length, Number(signal.currentValue ?? 0));

  switch (key) {
    case 'scope': {
      if (signal.kind === 'sharp_drop' || signal.kind === 'visibility_slipping') {
        return { type: 'scope', scope: 'all_prompts' };
      }
      if (str(p, 'entity') === 'pages' && targets[0]?.id === 'site') {
        return { type: 'scope', scope: 'site' };
      }
      if (entity === 'topics') return { type: 'scope', scope: 'topic' };
      if (
        entity === 'platforms' ||
        signal.kind === 'platform_gap' ||
        signal.kind === 'new_engine'
      ) {
        return { type: 'scope', scope: 'platform' };
      }
      if (entity === 'regions') return { type: 'scope', scope: 'location' };
      if (str(p, 'promptId') || entity === 'prompts') return { type: 'scope', scope: 'prompt' };
      return null;
    }
    case 'prompt': {
      const text = str(p, 'promptText');
      if (!text) return null;
      return { type: 'prompt', id: str(p, 'promptId') || null, text };
    }
    case 'prompts': {
      if (entity === 'topics' && typeof p.prompts === 'number') {
        return { type: 'prompts', items: [], total: p.prompts };
      }
      if (entity !== 'prompts' || targets.length === 0) {
        const ids = Array.isArray(p.promptIds) ? p.promptIds : [];
        return ids.length > 0
          ? { type: 'prompts', items: [], total: Number(signal.currentValue ?? ids.length) }
          : null;
      }
      return {
        type: 'prompts',
        items: targets.map((t) => ({
          id: typeof t.id === 'string' ? t.id : null,
          text: label(t),
        })),
        total,
      };
    }
    case 'topic': {
      if (entity === 'topics') {
        const name = label(targets[0] ?? {});
        return name ? { type: 'text', text: name } : null;
      }
      const topics = signal.where.topics;
      if (topics.length > 1) return { type: 'list', items: [...topics], total: topics.length };
      return topics[0] ? { type: 'text', text: topics[0] } : null;
    }
    case 'platforms': {
      if (signal.where.platforms.length) {
        return { type: 'platforms', slugs: signal.where.platforms };
      }
      // A competitor's recorded positions say which platforms it leads on.
      const leading = [...new Set(promptPositions(p.positions).map((row) => row.platform))];
      if (leading.length) return { type: 'platforms', slugs: leading.filter(Boolean) };
      if (
        signal.kind === 'sharp_drop' ||
        signal.kind === 'visibility_slipping' ||
        entity === 'regions'
      ) {
        return { type: 'all_platforms' };
      }
      return null;
    }
    case 'locations':
      return signal.where.regions.length
        ? { type: 'locations', codes: signal.where.regions }
        : null;
    case 'domain': {
      const domain = str(p, 'domain');
      return domain ? { type: 'text', text: domain } : null;
    }
    case 'competitor': {
      const named = str(p, 'competitorName');
      if (named) return { type: 'text', text: named };
      const leaders = [
        ...new Set(targets.map((t) => (typeof t.competitor === 'string' ? t.competitor : ''))),
      ].filter(Boolean);
      return leaders.length ? { type: 'list', items: leaders, total: leaders.length } : null;
    }
    case 'url': {
      const url = str(p, 'landingPage') || str(p, 'url');
      return url ? { type: 'text', text: url } : null;
    }
    case 'pages': {
      if (entity === 'pages' && targets.length && targets[0]?.id !== 'site') {
        return { type: 'list', items: targets.map(label), total };
      }
      const urls = Array.isArray(p.urls) ? (p.urls as { url?: unknown }[]) : [];
      const items = urls.map((u) => (typeof u.url === 'string' ? u.url : '')).filter(Boolean);
      return items.length ? { type: 'list', items, total: Math.max(items.length, total) } : null;
    }
    case 'queries':
      return entity === 'queries' && targets.length
        ? { type: 'list', items: targets.map(label), total }
        : null;
    case 'engagementRank':
      return typeof p.valueRank === 'number' ? { type: 'number', value: p.valueRank } : null;
    case 'lostUrl': {
      const lost = citedPages(p.lostUrls);
      if (lost.length) return { type: 'citations', items: lost };
      // An owned page that stopped being cited is the lost URL itself.
      return signal.kind === 'owned_page_citation_lost' && targets.length
        ? { type: 'list', items: targets.map(label), total }
        : null;
    }
    case 'citedNow': {
      const now = citedPages(p.citedNow);
      return now.length ? { type: 'citations', items: now } : null;
    }
    case 'competitorPositions': {
      const rows = promptPositions(p.positions);
      return rows.length
        ? { type: 'positions', competitor: str(p, 'competitorName'), items: rows }
        : null;
    }
    case 'winningSources': {
      const sources = winningSourcesOf(p.winningSources);
      return sources.length ? { type: 'sources', items: sources } : null;
    }
    case 'evidence': {
      const checks = targets.flatMap((t) =>
        Array.isArray(t.checks) ? t.checks.filter((c): c is string => typeof c === 'string') : [],
      );
      const unique = [...new Set(checks)];
      return unique.length ? { type: 'list', items: unique, total: unique.length } : null;
    }
    default:
      return null;
  }
}

// A place the payload names is where the signal happened; one read from its
// prompts is where those are tracked, and is labelled so.
const TRACKED: Partial<Record<WhereFieldKey, WhereFieldKey>> = {
  platforms: 'trackedOn',
  locations: 'trackedIn',
};

function placeIsNamed(signal: Signal): boolean {
  const p = signal.payload ?? {};
  return (
    typeof p.platform === 'string' ||
    typeof p.region === 'string' ||
    (Array.isArray(p.platforms) && p.platforms.length > 0) ||
    // A competitor's recorded positions name the platforms it leads on.
    (Array.isArray(p.positions) && p.positions.length > 0)
  );
}

/** The Where block: the spec's fields for this signal, each with its value or none. */
export function signalWhereFields(signal: Signal): WhereField[] {
  const layout =
    signal.kind === 'first_citation'
      ? FIRST_CITATION_LAYOUT
      : CITATION_LOSS.includes(signal.kind)
        ? CITATION_LOSS_LAYOUT
        : LAYOUT[signal.category];
  const named = placeIsNamed(signal);
  return layout
    .map((key) => {
      const value = fieldValue(signal, key);
      const tracked = TRACKED[key];
      return {
        // Only a value read from the prompts is renamed; a missing one keeps
        // the spec's question ("which platforms?").
        key:
          tracked && !named && (value?.type === 'platforms' || value?.type === 'locations')
            ? tracked
            : key,
        value,
      };
    })
    .filter((field) => field.value !== null || !OPTIONAL.has(field.key));
}

// ─── Evidence ───────────────────────────────────────────────────────────────

/** A page that shows what the signal rests on, by app path. */
export interface SignalLink {
  kind:
    | 'prompt_answers'
    | 'prompts'
    | 'topic'
    | 'citations'
    | 'competitors'
    | 'traffic'
    | 'audit'
    | 'insights';
  href: string;
}

export function signalLinks(signal: Signal): SignalLink[] {
  const p = signal.payload ?? {};
  const promptId = str(p, 'promptId');
  if (promptId) {
    return [{ kind: 'prompt_answers', href: `/dashboard/prompts/${promptId}` }];
  }
  const entity = str(p, 'entity');
  const first = targetsOf(signal)[0];
  if (entity === 'topics' && typeof first?.id === 'string') {
    return [{ kind: 'topic', href: `/dashboard/topics/${first.id}` }];
  }
  // One prompt's answers for a one-prompt finding; a larger one lists its
  // prompts in Where, each linked, and points at the prompts list here.
  if (entity === 'prompts' && typeof first?.id === 'string') {
    return targetsOf(signal).length === 1
      ? [{ kind: 'prompt_answers', href: `/dashboard/prompts/${first.id}` }]
      : [{ kind: 'prompts', href: '/dashboard/prompts' }];
  }
  if (entity === 'sources' || signal.category === 'citation') {
    return [{ kind: 'citations', href: '/dashboard/citations' }];
  }
  switch (signal.category) {
    case 'competitor':
      return [{ kind: 'competitors', href: '/dashboard/competitors' }];
    case 'traffic':
      return [{ kind: 'traffic', href: '/dashboard/traffic' }];
    case 'technical':
      return [{ kind: 'audit', href: '/dashboard/audit' }];
    default:
      return [{ kind: 'insights', href: '/dashboard/insights' }];
  }
}

// ─── For the API ────────────────────────────────────────────────────────────

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function apiValue(value: WhereValue): unknown {
  switch (value.type) {
    case 'text':
      return value.text;
    case 'scope':
      return value.scope;
    case 'number':
      return value.value;
    case 'prompt':
      return { id: value.id, text: value.text };
    case 'prompts':
      return { total: value.total, items: value.items };
    case 'list':
      return { total: value.total, items: value.items };
    case 'platforms':
      return value.slugs.map((slug) => ({ slug, name: platformName(slug) }));
    case 'all_platforms':
      return 'all';
    case 'positions':
      return value.items.map((row) => ({
        prompt_id: row.promptId,
        prompt_text: row.promptText,
        platform: { slug: row.platform, name: platformName(row.platform) },
        competitor: row.competitor,
        you: row.you,
      }));
    case 'sources':
      return value.items.map((source) => ({
        domain: source.domain,
        answers: source.answers,
        answers_read: source.answersRead,
      }));
    case 'citations':
      return value.items.map((page) => ({
        url: page.url,
        position: page.position,
        ...(page.lastCitedAt ? { last_cited_at: page.lastCitedAt } : {}),
        ...(page.answers !== undefined ? { answers: page.answers } : {}),
        ...(page.answersRead !== undefined ? { answers_read: page.answersRead } : {}),
      }));
    case 'locations':
      return value.codes.map((code) => ({ code, name: locationName(code) }));
  }
}

export interface SignalActionRef {
  id: string;
  action_no: number;
  kind: string;
  status: string;
}

/**
 * A signal's detail in the shape the MCP tools return (AC-001: "the signal
 * API/MCP returns the same structured fields"): snake_case keys, a null for
 * every field no detector records yet, and every figure with its unit.
 */
export function signalDetailForApi(signal: Signal, actions: SignalActionRef[]) {
  const change = signalChange(signal);
  return {
    where: Object.fromEntries(
      signalWhereFields(signal).map(({ key, value }) => [
        snake(key),
        value ? apiValue(value) : null,
      ]),
    ),
    change: change && {
      period: change.period,
      figures: change.figures.map((f) => ({
        metric: f.metric,
        role: f.role,
        value: f.value,
        unit: METRIC_UNITS[f.metric],
        subject: f.subject ?? null,
        subject_type: f.subjectType ?? null,
        of: f.of ?? null,
      })),
    },
    evidence: {
      first_detected_at: signal.detectedAt,
      last_detected_at: signal.lastDetectedAt,
      links: signalLinks(signal).map((link) => ({ kind: link.kind, path: link.href })),
    },
    used_by_actions: actions,
  };
}
