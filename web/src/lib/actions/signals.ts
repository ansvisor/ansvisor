'use server';

/**
 * Action Center signals — reads and triage writes.
 *
 * The rows are produced nightly by the server's detectors; this module only
 * reads them and moves their status. Titles and descriptions do not exist in
 * the database (they are i18n templates composed in the UI from `kind` +
 * `payload`), which is also why the free-text search box filters
 * client-side: there is no stored text to search.
 */

import { createClient } from '@/lib/supabase/server';
import {
  isSignalKind,
  type SignalCategory,
  type SignalImpact,
  type SignalKind,
  type SignalSource,
  type SignalStatus,
} from '@/lib/signals/registry';

export interface Signal {
  id: string;
  category: SignalCategory;
  kind: SignalKind;
  impact: SignalImpact;
  status: SignalStatus;
  source: SignalSource[];
  detectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  previousValue: number | null;
  currentValue: number | null;
  changeValue: number | null;
  payload: Record<string, unknown>;
  kpiKeys: string[];
  actionId: string | null;
}

export interface SignalFilters {
  category?: SignalCategory;
  impact?: SignalImpact;
  status?: SignalStatus;
  source?: SignalSource;
  /** ISO day bounds on detected_at, inclusive. */
  dayFrom: string;
  dayTo: string;
}

interface SignalRow {
  id: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  source: string[];
  detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  previous_value: number | null;
  current_value: number | null;
  change_value: number | null;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  action_id: string | null;
}

/**
 * A brand's signals for the window, newest first. Fetched whole (up to the
 * PostgREST 1000-row cap) rather than paged: per-brand signal counts are
 * tens — the detectors' own thresholds and dedup bound them — and search
 * plus pagination happen client-side over composed titles anyway.
 */
export async function getSignals(brandId: string, filters: SignalFilters): Promise<Signal[]> {
  const supabase = await createClient();
  let query = supabase
    .from('signals')
    .select(
      'id, category, kind, impact, status, source, detected_at, last_detected_at, resolved_at, previous_value, current_value, change_value, payload, kpi_keys, action_id',
    )
    .eq('brand_id', brandId)
    .gte('detected_at', `${filters.dayFrom}T00:00:00.000Z`)
    .lt('detected_at', nextDay(filters.dayTo))
    .order('detected_at', { ascending: false })
    .limit(1000);

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.impact) query = query.eq('impact', filters.impact);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.source) query = query.contains('source', [filters.source]);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as SignalRow[])
    .filter((row) => isSignalKind(row.kind))
    .map((row) => ({
      id: row.id,
      category: row.category as SignalCategory,
      kind: row.kind as SignalKind,
      impact: row.impact as SignalImpact,
      status: row.status as SignalStatus,
      source: (row.source ?? []) as SignalSource[],
      detectedAt: row.detected_at,
      lastDetectedAt: row.last_detected_at,
      resolvedAt: row.resolved_at,
      previousValue: row.previous_value === null ? null : Number(row.previous_value),
      currentValue: row.current_value === null ? null : Number(row.current_value),
      changeValue: row.change_value === null ? null : Number(row.change_value),
      payload: row.payload ?? {},
      kpiKeys: row.kpi_keys ?? [],
      actionId: row.action_id,
    }));
}

export interface SignalsSummary {
  total: number;
  prevTotal: number;
  important: number;
  newCount: number;
  resolved: number;
  /** ISO day → count, for the card sparklines. */
  byDay: Record<string, number>;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
}

export async function getSignalsSummary(
  brandId: string,
  dayFrom: string,
  dayTo: string,
): Promise<SignalsSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('signals_summary', {
    p_brand_id: brandId,
    p_from: `${dayFrom}T00:00:00.000Z`,
    p_to: nextDay(dayTo),
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as {
    total?: number;
    prev_total?: number;
    important?: number;
    new?: number;
    resolved?: number;
    by_day?: Record<string, number>;
    by_category?: Record<string, number>;
    by_source?: Record<string, number>;
  };
  return {
    total: Number(raw.total ?? 0),
    prevTotal: Number(raw.prev_total ?? 0),
    important: Number(raw.important ?? 0),
    newCount: Number(raw.new ?? 0),
    resolved: Number(raw.resolved ?? 0),
    byDay: raw.by_day ?? {},
    byCategory: raw.by_category ?? {},
    bySource: raw.by_source ?? {},
  };
}

/**
 * Triage: any org member can move a signal through its lifecycle (RLS
 * enforces membership). Resolving stamps resolved_at; leaving the resolved
 * state clears it so the summary's "Resolved" count stays truthful.
 */
export async function updateSignalStatus(
  brandId: string,
  signalId: string,
  status: SignalStatus,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('signals')
    .update({
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('brand_id', brandId)
    .eq('id', signalId);
  if (error) throw new Error(error.message);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
}
