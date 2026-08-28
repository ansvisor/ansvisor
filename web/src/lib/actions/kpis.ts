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
  type KpiCategory,
  type KpiDirection,
  type KpiKey,
  type KpiTimeframe,
  type KpiUnit,
} from '@/lib/kpis/registry';
import { deriveKpiStatus, kpiProgress, type KpiStatus } from '@/lib/kpis/status';
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
async function fetchWindowMetrics(brandId: string, timeframe: KpiTimeframe, keys: Set<KpiKey>) {
  const windowDays = TIMEFRAME_DAYS[timeframe];
  const days = { dayFrom: daysAgo(windowDays - 1), dayTo: utcToday() };
  const trendFrom = daysAgo(TREND_DAYS - 1);

  const wantsInsights = keys.has('citations') || keys.has('mentions');

  const [visibility, insights, sov, traffic, trafficTrend, dailyTotals] = await Promise.all([
    keys.has('ai_visibility') ? getVisibilityRateTrend(brandId, { days }) : null,
    wantsInsights ? getInsightsSummary(brandId, { days }) : null,
    keys.has('share_of_voice') ? getShareOfVoiceData(brandId, { days }) : null,
    keys.has('ai_referral_traffic')
      ? getTrafficSummary(brandId, {
          dateFrom: `${days.dayFrom}T00:00:00.000Z`,
          dateTo: new Date().toISOString(),
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

  const progress = kpiProgress(value, def.target, meta.direction);
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
    target: def.target,
    progress,
    status: deriveKpiStatus({ progress, change, direction: meta.direction }),
  };
}

export async function getKpiSnapshots(brandId: string): Promise<KpiSnapshotsResult> {
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

  const snapshots: KpiSnapshot[] = [];
  await Promise.all(
    [...byTimeframe.entries()].map(async ([timeframe, defs]) => {
      const metrics = await fetchWindowMetrics(
        brandId,
        timeframe,
        new Set(defs.map((d) => d.kpiKey)),
      );
      for (const def of defs) {
        const snapshot = buildSnapshot(def, metrics);
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

/**
 * One-click way in from the empty state: activate the core AI-search KPI set
 * with registry default targets. The framework drawer (follow-up issue)
 * generalizes this into picking templates and editing targets; existing
 * definitions are left untouched so re-applying can never overwrite a target
 * someone set deliberately. RLS restricts the write to admins and managers.
 */
export async function applyDefaultKpis(brandId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('kpi_definitions').upsert(
    DEFAULT_KPI_SET.map((key) => ({
      brand_id: brandId,
      kpi_key: key,
      target: KPI_REGISTRY[key].defaultTarget,
      timeframe: 'monthly',
    })),
    { onConflict: 'brand_id,kpi_key', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
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
