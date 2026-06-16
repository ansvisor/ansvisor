'use server';

import { createClient } from '@/lib/supabase/server';

const AEO_SERVER_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost';

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
  remaining: number;
}

export interface AuditSummary {
  id: string;
  url: string;
  status: 'running' | 'completed' | 'failed';
  total_score: number | null;
  signals_evaluated: number | null;
  signals_total: number;
  created_at: string;
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

/** List recent audits for a brand (summaries, no signal detail). */
export async function getAudits(brandId: string): Promise<AuditSummary[]> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/audits?brandId=${encodeURIComponent(brandId)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.audits ?? [];
}
