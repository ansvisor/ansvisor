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
import type {
  SignalCategory,
  SignalImpact,
  SignalSource,
  SignalStatus,
} from '@/lib/signals/registry';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type Signal, type SignalRow } from '@/lib/signals/map';

export type { Signal } from '@/lib/signals/map';

export interface SignalFilters {
  category?: SignalCategory;
  impact?: SignalImpact;
  status?: SignalStatus;
  source?: SignalSource;
  /** ISO day bounds, inclusive. A signal is in the window when its lifetime
   *  overlaps it — same semantics as the summary's "total". */
  dayFrom: string;
  dayTo: string;
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
    .select(SIGNAL_ROW_COLUMNS)
    .eq('brand_id', brandId)
    .lt('detected_at', nextDay(filters.dayTo))
    .or(`resolved_at.is.null,resolved_at.gte.${filters.dayFrom}T00:00:00.000Z`)
    .order('detected_at', { ascending: false })
    .limit(1000);

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.impact) query = query.eq('impact', filters.impact);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.source) query = query.contains('source', [filters.source]);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return mapSignalRows((data ?? []) as SignalRow[]);
}

export interface SignalsSummary {
  /** Conditions active in the window (lifetime overlaps it). */
  total: number;
  prevTotal: number;
  /** High-impact subset of `total`. */
  important: number;
  prevImportant: number;
  /** Conditions first detected inside the window. */
  newCount: number;
  prevNew: number;
  /** Conditions resolved inside the window. */
  resolved: number;
  prevResolved: number;
  /** ISO day → count series for the card sparklines. */
  byDayActive: Record<string, number>;
  byDayImportant: Record<string, number>;
  byDayNew: Record<string, number>;
  byDayResolved: Record<string, number>;
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
    prev_important?: number;
    new?: number;
    prev_new?: number;
    resolved?: number;
    prev_resolved?: number;
    by_day_active?: Record<string, number>;
    by_day_important?: Record<string, number>;
    by_day_new?: Record<string, number>;
    by_day_resolved?: Record<string, number>;
    by_category?: Record<string, number>;
    by_source?: Record<string, number>;
  };
  return {
    total: Number(raw.total ?? 0),
    prevTotal: Number(raw.prev_total ?? 0),
    important: Number(raw.important ?? 0),
    prevImportant: Number(raw.prev_important ?? 0),
    newCount: Number(raw.new ?? 0),
    prevNew: Number(raw.prev_new ?? 0),
    resolved: Number(raw.resolved ?? 0),
    prevResolved: Number(raw.prev_resolved ?? 0),
    byDayActive: raw.by_day_active ?? {},
    byDayImportant: raw.by_day_important ?? {},
    byDayNew: raw.by_day_new ?? {},
    byDayResolved: raw.by_day_resolved ?? {},
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
