/**
 * The KPI registry — static product knowledge about every KPI the Action
 * Center can track. The database (`kpi_definitions`) stores only what the
 * user decided: target, timeframe, active. Everything intrinsic to a KPI —
 * what it measures, its unit, which way is up, where the number comes from —
 * lives here, keyed by `kpi_key`, so a metric's meaning cannot drift per
 * brand and adding a KPI never takes a migration.
 *
 * Display names and descriptions are next-intl keys under
 * `actionCenter.registry.<key>`, not strings: the registry is imported by
 * server actions where no translator is in scope.
 */

export type KpiKey =
  | 'ai_visibility'
  | 'citations'
  | 'mentions'
  | 'share_of_voice'
  | 'ai_referral_traffic';

export type KpiCategory = 'visibility' | 'citations' | 'mentions' | 'traffic' | 'content';

export type KpiUnit = 'percent' | 'count' | 'sessions';

/**
 * Which way improvement points. Every v1 KPI grows upward, but the field is
 * in the model from the start because retrofitting it later would mean
 * revisiting every place that colors a change arrow (negative-sentiment or
 * issue-count KPIs will invert it).
 */
export type KpiDirection = 'higher_is_better' | 'lower_is_better';

/** Where the snapshot value is computed from. GA-backed KPIs are skipped for
 *  brands without the connection instead of rendering as zero. */
export type KpiSource = 'tracking' | 'ga';

export type KpiTimeframe = 'weekly' | 'monthly' | 'quarterly';

export interface KpiMeta {
  key: KpiKey;
  category: KpiCategory;
  unit: KpiUnit;
  direction: KpiDirection;
  source: KpiSource;
  /** Seed target for the default framework, in the KPI's own unit. */
  defaultTarget: number;
}

export const KPI_REGISTRY: Record<KpiKey, KpiMeta> = {
  ai_visibility: {
    key: 'ai_visibility',
    category: 'visibility',
    unit: 'percent',
    direction: 'higher_is_better',
    source: 'tracking',
    defaultTarget: 50,
  },
  citations: {
    key: 'citations',
    category: 'citations',
    unit: 'count',
    direction: 'higher_is_better',
    source: 'tracking',
    defaultTarget: 100,
  },
  mentions: {
    key: 'mentions',
    category: 'mentions',
    unit: 'count',
    direction: 'higher_is_better',
    source: 'tracking',
    defaultTarget: 100,
  },
  share_of_voice: {
    key: 'share_of_voice',
    category: 'visibility',
    unit: 'percent',
    direction: 'higher_is_better',
    source: 'tracking',
    defaultTarget: 35,
  },
  ai_referral_traffic: {
    key: 'ai_referral_traffic',
    category: 'traffic',
    unit: 'sessions',
    direction: 'higher_is_better',
    source: 'tracking',
    defaultTarget: 100,
  },
};

export const KPI_KEYS = Object.keys(KPI_REGISTRY) as KpiKey[];

export function isKpiKey(value: string): value is KpiKey {
  return value in KPI_REGISTRY;
}

/**
 * The default framework applied from the empty state: the core AI-search
 * set. The framework drawer (follow-up issue) generalizes this into
 * user-picked templates; until then this is the one-click way in.
 */
export const DEFAULT_KPI_SET: KpiKey[] = [
  'ai_visibility',
  'citations',
  'mentions',
  'share_of_voice',
  'ai_referral_traffic',
];

/** Days in a timeframe's comparison window. */
export const TIMEFRAME_DAYS: Record<KpiTimeframe, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
};
