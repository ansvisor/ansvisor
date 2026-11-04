import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllRpcRows } from '@/lib/supabase/rpc-pages';

/**
 * The free report card's admin view (REPORT-CARD §7): for Ansvisor staff,
 * how many requests came, how many cards were made, what they cost against
 * the month's budget and how many failed. Counts and sites only: no
 * person's name or e-mail is shown. Read with the service role (00472's
 * tables have no policies).
 */

/** Days the table lists, newest first. */
export const DAYS_SHOWN = 14;
/** Failures listed. */
const FAILURES_SHOWN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CardRow {
  id?: string;
  site: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  cost_usd: number | string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface RequestRow {
  id?: string;
  created_at: string;
  outcome: 'queued' | 'resent' | 'daily_cap';
  email_status: 'sent' | 'refused' | 'unknown' | 'skipped' | null;
  consent_marketing: boolean;
}

export interface DayRow {
  /** YYYY-MM-DD, UTC. */
  date: string;
  requests: number;
  resent: number;
  capped: number;
  started: number;
  ready: number;
  failed: number;
  costUsd: number;
  emailsSent: number;
  emailsFailed: number;
}

export interface ReportCardStats {
  today: DayRow;
  month: { costUsd: number; budgetUsd: number; cards: number };
  dailyCap: number;
  /** Failed of the cards finished in the last 30 days, in percent; null with none finished. */
  errorRate: number | null;
  queued: number;
  marketingOptIns: number;
  days: DayRow[];
  failures: { site: string; at: string; error: string }[];
}

const dayOf = (iso: string) => iso.slice(0, 10);
const money = (value: number | string) => Number(value) || 0;

/** The caps as the server reads them (server/src/lib/report-card/config.js). */
export function adminLimits(env: Record<string, string | undefined> = process.env) {
  const num = (raw: string | undefined, fallback: number) => {
    const value = Number(raw);
    return raw !== undefined && raw.trim() !== '' && Number.isFinite(value) && value >= 0
      ? value
      : fallback;
  };
  return {
    dailyCap: num(env.REPORT_CARD_DAILY_CAP, 200),
    budgetUsd: num(env.REPORT_CARD_MONTHLY_BUDGET_USD, 200),
  };
}

export function summarizeReportCards({
  cards,
  requests,
  now,
  budgetUsd,
  dailyCap,
}: {
  cards: CardRow[];
  requests: RequestRow[];
  now: Date;
  budgetUsd: number;
  dailyCap: number;
}): ReportCardStats {
  const empty = (date: string): DayRow => ({
    date,
    requests: 0,
    resent: 0,
    capped: 0,
    started: 0,
    ready: 0,
    failed: 0,
    costUsd: 0,
    emailsSent: 0,
    emailsFailed: 0,
  });
  const days = new Map<string, DayRow>();
  for (let i = 0; i < DAYS_SHOWN; i += 1) {
    const date = dayOf(new Date(now.getTime() - i * DAY_MS).toISOString());
    days.set(date, empty(date));
  }

  for (const r of requests) {
    const day = days.get(dayOf(r.created_at));
    if (!day) continue;
    day.requests += 1;
    if (r.outcome === 'resent') day.resent += 1;
    if (r.outcome === 'daily_cap') day.capped += 1;
    if (r.email_status === 'sent') day.emailsSent += 1;
    if (r.email_status === 'refused' || r.email_status === 'unknown') day.emailsFailed += 1;
  }

  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const since30 = now.getTime() - 30 * DAY_MS;
  let monthCost = 0;
  let monthCards = 0;
  let finished = 0;
  let failedCount = 0;
  let queued = 0;
  for (const c of cards) {
    if (c.status === 'queued') queued += 1;
    if (c.started_at) {
      const day = days.get(dayOf(c.started_at));
      if (day) {
        day.started += 1;
        day.costUsd += money(c.cost_usd);
        if (c.status === 'ready') day.ready += 1;
        if (c.status === 'failed') day.failed += 1;
      }
    }
    if (dayOf(c.created_at) >= monthStart) {
      monthCost += money(c.cost_usd);
      monthCards += 1;
    }
    if (c.finished_at && new Date(c.finished_at).getTime() >= since30) {
      finished += 1;
      if (c.status === 'failed') failedCount += 1;
    }
  }

  const failures = cards
    .filter((c) => c.status === 'failed' && c.finished_at)
    .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
    .slice(0, FAILURES_SHOWN)
    .map((c) => ({ site: c.site, at: c.finished_at ?? c.created_at, error: c.error ?? '' }));

  const list = [...days.values()];
  return {
    today: list[0],
    month: { costUsd: monthCost, budgetUsd, cards: monthCards },
    dailyCap,
    errorRate: finished ? Math.round((failedCount / finished) * 100) : null,
    queued,
    marketingOptIns: requests.filter(
      (r) => r.consent_marketing && new Date(r.created_at).getTime() >= since30,
    ).length,
    days: list,
    failures,
  };
}

/** The view's figures, read with the service role. */
export async function loadReportCardStats(
  db: SupabaseClient,
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<ReportCardStats> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = new Date(Math.min(now.getTime() - 30 * DAY_MS, monthStart.getTime()));
  // PostgREST gives at most 1,000 rows a request: every row is read, a page
  // at a time in id order, so the figures never come from a subset.
  const CARD_COLUMNS = 'id, site, status, cost_usd, created_at, started_at, finished_at, error';
  const [cards, requests, waiting] = await Promise.all([
    readAllRpcRows<CardRow>((from, to) =>
      db
        .from('report_cards')
        .select(CARD_COLUMNS)
        .gte('created_at', since.toISOString())
        .order('id')
        .range(from, to),
    ),
    readAllRpcRows<RequestRow>((from, to) =>
      db
        .from('report_card_requests')
        .select('id, created_at, outcome, email_status, consent_marketing')
        .gte('created_at', new Date(now.getTime() - 30 * DAY_MS).toISOString())
        .order('id')
        .range(from, to),
    ),
    // Cards queued before the window still wait: counted with the rest.
    readAllRpcRows<CardRow>((from, to) =>
      db
        .from('report_cards')
        .select(CARD_COLUMNS)
        .eq('status', 'queued')
        .lt('created_at', since.toISOString())
        .order('id')
        .range(from, to),
    ),
  ]).catch((err: Error) => {
    throw new Error(`report card stats: ${err.message}`);
  });
  // A row a later page shifted onto twice (rows written between pages) counts once.
  const once = <T extends { id?: string }>(rows: T[]) => [
    ...new Map(rows.map((r, i) => [r.id ?? String(i), r])).values(),
  ];
  return summarizeReportCards({
    cards: once([...cards, ...waiting]),
    requests: once(requests),
    now,
    ...adminLimits(env),
  });
}
