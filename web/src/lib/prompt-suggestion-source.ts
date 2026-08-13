/**
 * Shapes and guards for the evidence behind a prompt suggestion.
 *
 * A plain module rather than part of `lib/actions/prompt-suggestions.ts`,
 * because that file is `'use server'` and every runtime export of a server
 * module has to be an async server action — a synchronous helper there fails
 * the production build, not the type check.
 */

export type GscSuggestionBadge = 'protect_traffic' | 'capture_demand' | 'low_competition';

export interface GscSuggestionSourceData {
  query: string;
  impressions: number;
  clicks: number;
  avgPosition: number | null;
  badge: GscSuggestionBadge | null;
  competitionIndex: number | null;
}

/**
 * Evidence behind an Analytics-derived suggestion (#705): either a page that
 * earns and has no prompt coverage, or one an AI engine already refers to.
 */
export interface GaSuggestionSourceData {
  landingPage: string;
  kind: 'revenue_blind_spot' | 'ai_momentum';
  rank: number;
  sessions: number;
  keyEvents: number;
  transactions: number;
  revenue: number;
  aiSessions: number;
  aiPlatforms: string[];
  pageTitle: string | null;
}

export type SuggestionSourceData = GscSuggestionSourceData | GaSuggestionSourceData;

export type PromptSuggestionSource = 'llm' | 'heuristic' | 'gsc' | 'ga';

interface SourceCarrier {
  source: PromptSuggestionSource;
  sourceData: SuggestionSourceData | null;
}

/**
 * Narrow `sourceData` to the shape its source promises.
 *
 * The `source` column and the payload are written together but read apart, so
 * these check both. A row whose source says one thing and whose payload says
 * another renders as a plain suggestion instead of reading fields that are not
 * there.
 */
export function gscSourceData(s: SourceCarrier): GscSuggestionSourceData | null {
  return s.source === 'gsc' && s.sourceData && 'query' in s.sourceData ? s.sourceData : null;
}

export function gaSourceData(s: SourceCarrier): GaSuggestionSourceData | null {
  return s.source === 'ga' && s.sourceData && 'landingPage' in s.sourceData ? s.sourceData : null;
}
