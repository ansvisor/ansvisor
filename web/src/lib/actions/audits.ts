'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';

const AEO_SERVER_URL = API_BASE_URL;

export type AuditSignalStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface AuditSignal {
  key: string;
  category: string | null;
  status: AuditSignalStatus;
  score: number | null;
  evidence: Record<string, unknown>;
  label: string;
  what: string | null;
  why: string | null;
  howToFix: string | null;
  impactTier: 'high' | 'medium' | 'standard' | null;
}

export interface CategoryScore {
  score: number | null;
  evaluated: number;
  total: number;
}

export interface AuditRecommendation {
  signalKey: string;
  label: string;
  category: string | null;
  priority: 'high' | 'medium' | 'low';
  recommendation: string;
  draft: string | null;
  /** JSON-LD or HTML to paste. Older audits keep markup in `draft` and lack this. */
  code?: string | null;
}

export interface AuditResult {
  id: string;
  brandId: string;
  url: string;
  finalUrl: string | null;
  status: 'running' | 'completed' | 'failed';
  totalScore: number | null;
  categoryScores: Record<string, CategoryScore>;
  signalsEvaluated: number | null;
  signalsTotal: number;
  rubricVersion: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  signals: AuditSignal[];
  recommendations: AuditRecommendation[];
}

export interface AuditQuota {
  used: number;
  limit: number;
  /** What's left this month, the running audits already taken out. */
  remaining: number;
  /** Audits started and not finished yet: they're charged when they complete. */
  running?: number;
}

export interface AuditTrendPoint {
  id: string;
  createdAt: string;
  totalScore: number | null;
  categoryScores: Record<string, CategoryScore>;
}

export interface AuditTrend {
  primaryDomain: string | null;
  points: AuditTrendPoint[];
}

/** One audit run of a page, in its history. */
export interface AuditRun {
  id: string;
  url: string;
  status: 'running' | 'completed' | 'failed';
  totalScore: number | null;
  createdAt: string;
}

export type AuditedPageStatus = 'good' | 'improving' | 'needs_work' | 'running' | 'failed';

/** One audited page: its repeat audits share the row. */
export interface AuditedPage {
  key: string;
  host: string | null;
  path: string;
  url: string;
  /** The latest completed audit (else the latest run), which the row opens. */
  auditId: string;
  score: number | null;
  previousScore: number | null;
  status: AuditedPageStatus;
  lastAuditedAt: string;
  /** Latest completed scores, oldest first. */
  trend: number[];
  /** Failed and warning signals in the latest completed audit. */
  issues: number | null;
  /** Runs, newest first. */
  runs: AuditRun[];
  runCount: number;
}

async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}

/** Run a new single-page audit (synchronous — returns the completed result). */
export async function runAudit(brandId: string, url: string): Promise<AuditResult> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, url }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.audit;
}

/** Fetch a single stored audit with all its signal results. */
export async function getAudit(auditId: string): Promise<AuditResult> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/${auditId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.audit;
}

/** Delete a stored audit (its signal rows cascade away). */
export async function deleteAudit(auditId: string): Promise<void> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/${auditId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }
}

/** The org's monthly Site Audit allowance (used / limit / remaining; limit -1 = unlimited). */
export async function getAuditQuota(): Promise<AuditQuota> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/quota`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.quota;
}

/** Score + category-score time series for the brand's primary domain. */
export async function getAuditTrend(brandId: string): Promise<AuditTrend> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/trend?brandId=${encodeURIComponent(brandId)}`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { primaryDomain: data.primaryDomain ?? null, points: data.points ?? [] };
}

/**
 * Re-audit several pages at once. Every page must fit the monthly quota, or
 * none starts; the server runs them a few at a time.
 */
export async function runAuditsBulk(brandId: string, urls: string[]): Promise<{ started: number }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits/bulk`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ brandId, urls }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { started: (data.audits ?? []).length };
}

/** One of the most common Authority / E-E-A-T gaps across the audited pages. */
export interface AuditGap {
  key: string;
  label: string;
  category: string | null;
  /** Pages whose latest audit fails or warns on it. */
  pages: number;
}

/** The hub's KPI cards, over the latest audit of each page on the primary domain. */
export interface AuditOverview {
  primaryHost: string | null;
  /** Audited pages on the primary domain. */
  pages: number;
  /** Audited pages on other sites, left out of the numbers. */
  otherPages: number;
  siteScore: number | null;
  /** Points against each page's previous audit; null when none was audited twice. */
  siteScoreChange: number | null;
  authority: number | null;
  eeat: number | null;
  gaps: AuditGap[];
}

export async function getAuditOverview(brandId: string): Promise<AuditOverview> {
  const session = await getSession();

  const res = await fetch(
    `${AEO_SERVER_URL}/api/audits/overview?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.overview;
}

export interface AuditedPages {
  pages: AuditedPage[];
  /** Pages audited for the brand, across all pages of the list. */
  total: number;
  /** The brand's primary host, whose pages are listed by path alone. */
  primaryHost: string | null;
}

/** List a page of the brand's audited pages, most recently audited first. */
export async function getAuditPages(
  brandId: string,
  offset = 0,
  limit = 50,
): Promise<AuditedPages> {
  const session = await getSession();

  const params = new URLSearchParams({
    brandId,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${AEO_SERVER_URL}/api/audits/pages?${params}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  const pages: AuditedPage[] = data.pages ?? [];
  return { pages, total: data.total ?? pages.length, primaryHost: data.primaryHost ?? null };
}
