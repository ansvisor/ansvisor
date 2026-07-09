'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/supabase';
import { API_BASE_URL } from '@/config/api';
import {
  getInsightsSummary,
  getShareOfVoiceData,
  getCompetitorComparison,
  type InsightsSummary,
  type CompetitorComparisonEntry,
  type SoVByPlatform,
} from '@/lib/actions/tracking';
import { getCitationsOverview, type CitationsSourceBreakdown } from '@/lib/actions/citations';
import type { SourceCategory } from '@/lib/citations/classify';

/**
 * Simple Reports MVP — generate, list and delete immutable report snapshots.
 *
 * `createReport` gathers the brand's metrics for the chosen period through the
 * existing analytics actions, asks the server for a 1-2 paragraph AI executive
 * summary, and saves everything as one JSONB payload in the `reports` table
 * (migration 00023). The detail page renders purely from that saved payload —
 * a report never changes after generation.
 */

// ─── Payload shape (what reports.payload stores) ─────────────────────────────

export interface ReportTopDomain {
  domain: string;
  category: SourceCategory;
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

export interface ReportPayload {
  brandName: string;
  /** AI-generated executive summary (plain prose). */
  summaryText: string;
  insights: InsightsSummary;
  shareOfVoice: {
    overallSov: number;
    overallSovChange: number | null;
    byPlatform: SoVByPlatform[];
  };
  /** Own brand + competitors, as returned by getCompetitorComparison. */
  competitors: CompetitorComparisonEntry[];
  citations: {
    totals: {
      domains: number;
      urls: number;
      citations: number;
      results: number;
      avgCitationsPerResult: number;
    };
    sourceTypeBreakdown: CitationsSourceBreakdown[];
    topDomains: ReportTopDomain[];
  };
}

export interface ReportListItem {
  id: string;
  brandId: string;
  title: string;
  template: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
}

export interface Report extends ReportListItem {
  payload: ReportPayload;
}

/** How many citation domains a report keeps (the table is capped, by design). */
const REPORT_TOP_DOMAINS = 10;

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function createReport(
  brandId: string,
  opts: { dateFrom: string; dateTo: string; title?: string },
): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { dateFrom, dateTo } = opts;
  const range = { dateFrom, dateTo };

  // 1. Gather the metric snapshot through the existing analytics actions.
  const [brandRow, insights, sov, comparison, citations] = await Promise.all([
    supabase.from('brands').select('name').eq('id', brandId).single(),
    getInsightsSummary(brandId, range),
    getShareOfVoiceData(brandId, range),
    getCompetitorComparison(brandId, range),
    getCitationsOverview(brandId, { datePreset: 'custom', dateFrom, dateTo }),
  ]);
  const brandName = (brandRow.data?.name as string) ?? 'Brand';

  const snapshot: Omit<ReportPayload, 'summaryText'> = {
    brandName,
    insights,
    shareOfVoice: {
      overallSov: sov.overallSov,
      overallSovChange: sov.overallSovChange,
      byPlatform: sov.byPlatform,
    },
    competitors: comparison.brands,
    citations: {
      totals: citations.totals,
      sourceTypeBreakdown: citations.sourceTypeBreakdown,
      topDomains: citations.rows.slice(0, REPORT_TOP_DOMAINS).map((r) => ({
        domain: r.domain,
        category: r.category,
        totalCitations: r.totalCitations,
        resultsCiting: r.resultsCiting,
        usagePct: r.usagePct,
      })),
    },
  };

  // 2. AI executive summary from the server (content.js-style single call).
  const res = await fetch(`${API_BASE_URL}/api/reports/summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, snapshot, dateFrom, dateTo }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Summary generation failed: ${res.status}`);
  }
  const { summary } = (await res.json()) as { summary: string };

  const payload: ReportPayload = { ...snapshot, summaryText: summary };

  // 3. Persist the immutable snapshot (RLS scopes the insert to org members).
  const title =
    opts.title?.trim() ||
    `${brandName} — Executive Summary (${dateFrom.slice(0, 10)} → ${dateTo.slice(0, 10)})`;

  const { data: created, error } = await supabase
    .from('reports')
    .insert({
      brand_id: brandId,
      title,
      template: 'executive_summary',
      date_from: dateFrom,
      date_to: dateTo,
      payload: payload as unknown as Json,
      created_by: session.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/reports');
  return { id: created.id as string };
}

export async function getReports(brandId: string): Promise<ReportListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id, brand_id, title, template, date_from, date_to, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    brandId: r.brand_id as string,
    title: r.title as string,
    template: r.template as string,
    dateFrom: r.date_from as string,
    dateTo: r.date_to as string,
    createdAt: r.created_at as string,
  }));
}

export async function getReport(id: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id, brand_id, title, template, date_from, date_to, payload, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id as string,
    brandId: data.brand_id as string,
    title: data.title as string,
    template: data.template as string,
    dateFrom: data.date_from as string,
    dateTo: data.date_to as string,
    createdAt: data.created_at as string,
    payload: data.payload as unknown as ReportPayload,
  };
}

export async function deleteReport(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/reports');
}
