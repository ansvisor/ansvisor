'use server';

/**
 * Action Center KPI snapshots.
 *
 * `kpi_definitions` stores what the user decided (target, timeframe, active);
 * this module computes everything a reader sees next to it — value, change,
 * 7-day trend, progress, status — at read time, from the same actions and
 * RPCs the analytics surfaces already use. Reusing those paths is the point:
 * a KPI row and the dashboard it summarizes cannot show different numbers,
 * because they are the same query.
 *
 * Nothing computed is ever written back. Status in particular is derived on
 * every read (lib/kpis/status.ts) so a badge can never go stale against the
 * value standing next to it.
 */

import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_KPI_SET,
  KPI_REGISTRY,
  TIMEFRAME_DAYS,
  isKpiKey,
  isValidKpiTarget,
  type KpiCategory,
  type KpiDirection,
  type KpiKey,
  type KpiTimeframe,
  type KpiUnit,
} from '@/lib/kpis/registry';
import {
  deriveKpiStatus,
  kpiProgress,
  scaleTargetToWindow,
  type KpiStatus,
} from '@/lib/kpis/status';
import {
  getInsightsSummary,
  getShareOfVoiceData,
  getVisibilityRateTrend,
} from './tracking';
import { getTrafficSummary, getTrafficTrend } from './traffic';

const TREND_DAYS = 7;

export interface KpiTrendPoint {
  date: string;
  value: number;
}

export interface KpiSnapshot {
  key: KpiKey;
  category: KpiCategory;
  unit: KpiUnit;
  direction: KpiDirection;
  timeframe: KpiTimeframe;
  /** Current value over the timeframe window, in the KPI's own unit. */
  value: number;
  /**
   * Movement vs the previous equal-length window. Points for percent-unit
   * KPIs, percent for counts — `changeKind` says which, and the UI must not
   * render "+2.4 pts" as "+2.4%".
   */
  change: number | null;
  changeKind: 'points' | 'percent';
  /** Last 7 days, oldest first. Empty when the source has no daily series. */
  trend: KpiTrendPoint[];
  target: number;
  /** value vs target as a percentage; may exceed 100. */
  progress: number;
  status: KpiStatus;
}

export interface KpiSnapshotsResult {
  /** False only when the brand has no definitions at all → empty state. */
  configured: boolean;
  kpis: KpiSnapshot[];
}

interface KpiDefinitionRow {
  kpi_key: string;
  target: number;
  timeframe: KpiTimeframe;
  is_active: boolean;
}

const DAY_MS = 86_400_000;

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function sumTrafficPoint(point: Record<string, unknown>): number {
  let sum = 0;
  for (const [key, val] of Object.entries(point)) {
    if (key !== 'date' && typeof val === 'number') sum += val;
  }
  return sum;
}

/**
 * Everything the tracking-backed KPIs in one timeframe window need, fetched
 * once and shared: five KPIs must not mean five times the round trips when
 * they share a window.
 */
async function fetchWindowMetrics(
  brandId: string,
  timeframe: KpiTimeframe,
  keys: Set<KpiKey>,
  windowOverride?: KpiWindow,
) {
  const windowDays = TIMEFRAME_DAYS[timeframe];
  const days = windowOverride ?? { dayFrom: daysAgo(windowDays - 1), dayTo: utcToday() };
  const trendFrom = daysAgo(TREND_DAYS - 1);

  const wantsInsights = keys.has('citations') || keys.has('mentions');

  const [visibility, insights, sov, traffic, trafficTrend, dailyTotals] = await Promise.all([
    keys.has('ai_visibility') ? getVisibilityRateTrend(brandId, { days }) : null,
    wantsInsights ? getInsightsSummary(brandId, { days }) : null,
    keys.has('share_of_voice') ? getShareOfVoiceData(brandId, { days }) : null,
    keys.has('ai_referral_traffic')
      ? getTrafficSummary(brandId, {
          dateFrom: `${days.dayFrom}T00:00:00.000Z`,
          dateTo: `${days.dayTo}T23:59:59.999Z`,
        })
      : null,
    keys.has('ai_referral_traffic')
      ? getTrafficTrend(brandId, {
          dateFrom: `${trendFrom}T00:00:00.000Z`,
          dateTo: new Date().toISOString(),
        })
      : null,
    // Mentions/citations have window aggregates but no daily-series RPC, so
    // the 7-point sparkline is seven one-day aggregates in parallel. Each is
    // a rollup read returning one JSON row; both KPIs share the same seven.
    wantsInsights ? fetchDailyInsightTotals(brandId) : null,
  ]);

  return { visibility, insights, sov, traffic, trafficTrend, dailyTotals };
}

async function fetchDailyInsightTotals(brandId: string) {
  const supabase = await createClient();
  const days = Array.from({ length: TREND_DAYS }, (_, i) => daysAgo(TREND_DAYS - 1 - i));
  const rows = await Promise.all(
    days.map(async (day) => {
      const { data, error } = await supabase.rpc('insights_aggregates_daily', {
        p_brand_id: brandId,
        p_platform: undefined,
        p_models: undefined,
        p_region: undefined,
        p_day_from: day,
        p_day_to: day,
      });
      if (error) throw new Error(error.message);
      const agg = (data ?? {}) as { total_mentions?: number; total_citations?: number };
      return {
        date: day,
        mentions: Number(agg.total_mentions ?? 0),
        citations: Number(agg.total_citations ?? 0),
      };
    }),
  );
  return rows;
}

type WindowMetrics = Awaited<ReturnType<typeof fetchWindowMetrics>>;

function buildSnapshot(
  def: { kpiKey: KpiKey; target: number; timeframe: KpiTimeframe },
  metrics: WindowMetrics,
  windowDays?: number,
): KpiSnapshot | null {
  const meta = KPI_REGISTRY[def.kpiKey];

  let value: number;
  let change: number | null;
  let changeKind: 'points' | 'percent';
  let trend: KpiTrendPoint[];

  switch (def.kpiKey) {
    case 'ai_visibility': {
      if (!metrics.visibility) return null;
      const { summary, points } = metrics.visibility;
      value = summary.rate;
      change = summary.change;
      changeKind = 'points';
      trend = points
        .slice(-TREND_DAYS)
        .map((p) => ({ date: p.date, value: p.values['you'] ?? 0 }));
      break;
    }
    case 'citations': {
      if (!metrics.insights || !metrics.dailyTotals) return null;
      value = metrics.insights.totalCitations;
      change = metrics.insights.citationsChange;
      changeKind = 'percent';
      trend = metrics.dailyTotals.map((d) => ({ date: d.date, value: d.citations }));
      break;
    }
    case 'mentions': {
      if (!metrics.insights || !metrics.dailyTotals) return null;
      value = metrics.insights.totalMentions;
      change = metrics.insights.mentionsChange;
      changeKind = 'percent';
      trend = metrics.dailyTotals.map((d) => ({ date: d.date, value: d.mentions }));
      break;
    }
    case 'share_of_voice': {
      if (!metrics.sov) return null;
      value = metrics.sov.overallSov;
      change = metrics.sov.overallSovChange;
      changeKind = 'points';
      trend = metrics.sov.trend
        .slice(-TREND_DAYS)
        .map((p) => ({ date: p.date, value: p.brandSov }));
      break;
    }
    case 'ai_referral_traffic': {
      if (!metrics.traffic || !metrics.trafficTrend) return null;
      value = metrics.traffic.totalVisits;
      change = percentChange(
        metrics.traffic.totalVisits,
        metrics.traffic.totalVisitsPrev > 0 ? metrics.traffic.totalVisitsPrev : null,
      );
      changeKind = 'percent';
      trend = metrics.trafficTrend
        .slice(-TREND_DAYS)
        .map((p) => ({ date: p.date, value: sumTrafficPoint(p) }));
      break;
    }
  }

  // With an explicit window, the goal is held against that window's slice
  // (flow metrics scale, percent levels don't) — otherwise a monthly target
  // next to a 7-day value would report false alarm on every row.
  const target = windowDays
    ? scaleTargetToWindow(def.target, meta.unit, windowDays, TIMEFRAME_DAYS[def.timeframe])
    : def.target;
  const progress = kpiProgress(value, target, meta.direction);
  return {
    key: def.kpiKey,
    category: meta.category,
    unit: meta.unit,
    direction: meta.direction,
    timeframe: def.timeframe,
    value,
    change,
    changeKind,
    trend,
    target,
    progress,
    status: deriveKpiStatus({ progress, change, direction: meta.direction }),
  };
}

/**
 * Whole-day UTC measurement window, inclusive on both ends. When given, it
 * overrides every KPI's own timeframe window — the toolbar's date range is
 * one control over one table, so all rows must answer for the same days.
 * The 7-day trend sparkline is deliberately not affected: its column is
 * labeled "Trend (7D)" whatever the window.
 */
export interface KpiWindow {
  dayFrom: string;
  dayTo: string;
}

export async function getKpiSnapshots(
  brandId: string,
  window?: KpiWindow,
): Promise<KpiSnapshotsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('kpi_definitions')
    .select('kpi_key, target, timeframe, is_active')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as KpiDefinitionRow[];
  if (rows.length === 0) return { configured: false, kpis: [] };

  // Only registry-known keys are computable. An unknown key (a KPI removed
  // from the registry, or a future source not shipped yet) is skipped, not
  // an error — old definitions must not take down the page.
  const active = rows
    .filter((r) => r.is_active && isKpiKey(r.kpi_key))
    .map((r) => ({
      kpiKey: r.kpi_key as KpiKey,
      target: Number(r.target),
      timeframe: r.timeframe,
    }));
  if (active.length === 0) return { configured: true, kpis: [] };

  // Definitions can carry different timeframes; each distinct one is a
  // distinct comparison window, fetched once and shared by its KPIs.
  const byTimeframe = new Map<KpiTimeframe, typeof active>();
  for (const def of active) {
    const group = byTimeframe.get(def.timeframe) ?? [];
    group.push(def);
    byTimeframe.set(def.timeframe, group);
  }

  const windowDays = window
    ? Math.round((Date.parse(window.dayTo) - Date.parse(window.dayFrom)) / DAY_MS) + 1
    : undefined;

  const snapshots: KpiSnapshot[] = [];
  await Promise.all(
    [...byTimeframe.entries()].map(async ([timeframe, defs]) => {
      const metrics = await fetchWindowMetrics(
        brandId,
        timeframe,
        new Set(defs.map((d) => d.kpiKey)),
        window,
      );
      for (const def of defs) {
        const snapshot = buildSnapshot(def, metrics, windowDays);
        if (snapshot) snapshots.push(snapshot);
      }
    }),
  );

  // Registry order, so the table reads the same on every load regardless of
  // which timeframe group resolved first.
  const order = new Map(DEFAULT_KPI_SET.map((k, i) => [k, i]));
  snapshots.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  return { configured: true, kpis: snapshots };
}

export interface KpiDefinition {
  kpiKey: KpiKey;
  target: number;
  timeframe: KpiTimeframe;
  isActive: boolean;
}

/** Raw definitions for the framework drawer's prefill — registry-known keys
 *  only, same skip rule as the snapshot read. */
export async function getKpiDefinitions(brandId: string): Promise<KpiDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('kpi_definitions')
    .select('kpi_key, target, timeframe, is_active')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as KpiDefinitionRow[])
    .filter((r) => isKpiKey(r.kpi_key))
    .map((r) => ({
      kpiKey: r.kpi_key as KpiKey,
      target: Number(r.target),
      timeframe: r.timeframe,
      isActive: r.is_active,
    }));
}

export interface KpiFrameworkEntry {
  key: KpiKey;
  target: number;
}

/**
 * Save & Apply from the framework drawer: the entries ARE the framework.
 * Listed KPIs are upserted active with their targets; every other definition
 * the brand has is deactivated, not deleted, so its target survives being
 * re-enabled later. One timeframe for the whole framework, per the drawer's
 * single Time Period control. RLS restricts the write to admins and managers.
 */
export async function saveKpiFramework(
  brandId: string,
  timeframe: KpiTimeframe,
  entries: KpiFrameworkEntry[],
): Promise<void> {
  if (entries.length === 0) throw new Error('empty framework');
  if (!(timeframe in TIMEFRAME_DAYS)) throw new Error('unknown timeframe');
  for (const entry of entries) {
    if (!isKpiKey(entry.key) || !isValidKpiTarget(entry.key, entry.target)) {
      throw new Error(`invalid target for ${entry.key}`);
    }
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('kpi_definitions').upsert(
    entries.map((entry) => ({
      brand_id: brandId,
      kpi_key: entry.key,
      target: entry.target,
      timeframe,
      is_active: true,
      updated_at: now,
    })),
    { onConflict: 'brand_id,kpi_key' },
  );
  if (error) throw new Error(error.message);

  // Safe as a not-in filter: kpi_key values come from the registry, which
  // has no commas or quotes to break PostgREST's list syntax.
  const { error: deactivateErr } = await supabase
    .from('kpi_definitions')
    .update({ is_active: false, updated_at: now })
    .eq('brand_id', brandId)
    .not('kpi_key', 'in', `(${entries.map((e) => e.key).join(',')})`);
  if (deactivateErr) throw new Error(deactivateErr.message);
}

/**
 * Remove deletes the definition outright. Pause/resume (is_active) waits for
 * the framework drawer: without a surface that lists paused KPIs, pausing
 * would make a row vanish with no way back.
 */
export async function removeKpi(brandId: string, kpiKey: KpiKey): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('kpi_definitions')
    .delete()
    .eq('brand_id', brandId)
    .eq('kpi_key', kpiKey);
  if (error) throw new Error(error.message);
}
