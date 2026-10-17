/**
 * Daily health report: one email each morning saying whether the night went
 * right and whether the dashboard's heaviest reads still fit their budget.
 *
 * Reports, never repairs. Each section degrades to a "could not check" line
 * instead of failing the report, so a broken check still produces an email
 * — silence would read as "all fine".
 *
 * Config (env):
 *   HEALTH_REPORT_RECIPIENTS  comma-separated addresses; no email without it
 *   HEALTH_PROBE_BRAND_ID     brand whose reads are timed (the largest we own)
 *   HEALTH_PROBE_USER_ID      a member of that brand's organization
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { sendEmail } from '../email.js';

/** The page reads' statement timeout, and the share of it that warns. */
export const READ_BUDGET_S = 8;
export const WARN_AT_S = 4;

/**
 * Reads timed against the probe brand: the page default, then a long window.
 * Topics goes first: it reads raw results, and timed after the long Citations
 * windows it measured their cache eviction rather than its own cost.
 */
export const PROBES = [
  { probe: 'topics_overview_aggregates', days: null },
  { probe: 'citations_domains_daily', days: 1 },
  { probe: 'citations_urls_daily', days: 1 },
  { probe: 'citations_domains_daily', days: 30 },
  { probe: 'citations_urls_daily', days: 30 },
  { probe: 'insights_aggregates_daily', days: 30 },
  { probe: 'competitor_aggregates_daily', days: 30 },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;
const RESTART_REASON = 'Server restarted during execution';

/** green / yellow / red for one timed read. */
export function probeStatus(seconds) {
  if (seconds == null) return 'red';
  if (seconds >= READ_BUDGET_S) return 'red';
  if (seconds >= WARN_AT_S) return 'yellow';
  return 'green';
}

async function runProbes() {
  const brandId = process.env.HEALTH_PROBE_BRAND_ID;
  const userId = process.env.HEALTH_PROBE_USER_ID;
  if (!brandId || !userId)
    return { skipped: 'HEALTH_PROBE_BRAND_ID / HEALTH_PROBE_USER_ID not set' };

  const results = [];
  // One at a time: this runs on the shared database after the nightly runs.
  for (const { probe, days } of PROBES) {
    const { data, error } = await supabaseAdmin.rpc('health_probe', {
      p_user_id: userId,
      p_brand_id: brandId,
      p_probe: probe,
      p_days: days,
    });
    const seconds = error ? null : Number(data);
    results.push({
      probe,
      days,
      seconds,
      error: error?.message ?? null,
      status: probeStatus(seconds),
    });
  }
  return { results };
}

async function brandNames(ids) {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('brands').select('id, name').in('id', ids);
  return new Map((data ?? []).map((b) => [b.id, b.name]));
}

/**
 * The last 24h of nightly (non-manual) tracking jobs, and the brands that ran
 * nightly in the week before but have no completed run in the last 24h.
 */
async function checkNightlyRuns(now) {
  const since = new Date(now - DAY_MS).toISOString();
  const weekAgo = new Date(now - 8 * DAY_MS).toISOString();

  const { data: jobs, error } = await supabaseAdmin
    .from('jobs')
    .select('id, brand_id, status, failed_reason, created_at, updated_at, data')
    .eq('type', 'tracking')
    .gte('created_at', weekAgo);
  if (error) throw new Error(error.message);

  const nightly = (jobs ?? []).filter((j) => j.data?.immediate !== true);
  const recent = nightly.filter((j) => j.created_at >= since);
  const counts = {};
  for (const j of recent) counts[j.status] = (counts[j.status] ?? 0) + 1;

  const failed = recent.filter((j) => j.status === 'failed');
  const stuck = recent.filter(
    (j) =>
      (j.status === 'waiting' || j.status === 'active') &&
      now - Date.parse(j.updated_at) > STUCK_AFTER_MS,
  );

  const ranBefore = new Set(nightly.filter((j) => j.created_at < since).map((j) => j.brand_id));
  const completedRecently = new Set(
    recent.filter((j) => j.status === 'completed').map((j) => j.brand_id),
  );
  const missing = [...ranBefore].filter((id) => !completedRecently.has(id));

  const names = await brandNames([
    ...new Set([...failed, ...stuck].map((j) => j.brand_id).concat(missing)),
  ]);
  const label = (id) => names.get(id) ?? id;

  return {
    counts,
    failed: failed.map((j) => ({ brand: label(j.brand_id), reason: j.failed_reason })),
    stuck: stuck.map((j) => ({ brand: label(j.brand_id), status: j.status })),
    missing: missing.map(label),
    restartKills: failed.filter((j) => j.failed_reason === RESTART_REASON).length,
  };
}

async function checkCloro(now) {
  const { count, error } = await supabaseAdmin
    .from('cloro_pending_tasks')
    .select('task_id', { count: 'exact', head: true })
    .lt('submitted_at', new Date(now - 60 * 60 * 1000).toISOString());
  if (error) throw new Error(error.message);
  return { pendingOverAnHour: count ?? 0 };
}

/**
 * Query fan-out. ChatGPT's went from about a quarter of answers to none on
 * 2026-09-30 and nothing noticed for two weeks. A platform is flagged when:
 *  - Cloro documents fan-out for it (FANOUT_EXPECTED) and a whole day of its
 *    answers carried none. This catches an outage however long it has run,
 *    which a comparison with the days before stops doing once they are empty
 *    too; or
 *  - its share over the last day fell below FANOUT_DROP_RATIO of its share
 *    over the BASELINE_DAYS before, for any other platform that fans out.
 */
export const FANOUT_EXPECTED = ['chatgpt-web', 'copilot-web', 'perplexity-web'];
export const FANOUT_DROP_RATIO = 0.25;
/** Fewer answers than this, on either side, are too few to judge. */
export const FANOUT_MIN_ANSWERS = 20;
/** A platform under this share before (it rarely fans out) is not flagged on a drop. */
export const FANOUT_MIN_BASELINE = 0.05;
/** Days before the last one that make the baseline. Kept short: the read scans every brand. */
export const BASELINE_DAYS = 3;

/** Each platform's fan-out share over the last day and over the days before. */
async function checkFanout(now) {
  const day = new Date(now - DAY_MS).toISOString();
  const week = new Date(now - (1 + BASELINE_DAYS) * DAY_MS).toISOString();
  const read = async (since, until) => {
    const { data, error } = await supabaseAdmin.rpc('fanout_coverage_by_platform', {
      p_since: since,
      p_until: until,
    });
    if (error) throw new Error(error.message);
    return new Map(
      (data ?? []).map((r) => [
        r.platform,
        { answers: Number(r.answers), withFanout: Number(r.answers_with_fanout) },
      ]),
    );
  };
  const [recent, before] = await Promise.all([
    read(day, new Date(now).toISOString()),
    read(week, day),
  ]);

  const platforms = [...new Set([...recent.keys(), ...before.keys()])].sort().map((platform) => {
    const r = recent.get(platform) ?? { answers: 0, withFanout: 0 };
    const b = before.get(platform) ?? { answers: 0, withFanout: 0 };
    return {
      platform,
      answers: r.answers,
      withFanout: r.withFanout,
      rate: r.answers ? r.withFanout / r.answers : null,
      baselineRate: b.answers ? b.withFanout / b.answers : null,
      baselineAnswers: b.answers,
    };
  });
  return { platforms };
}

/** A platform whose fan-out stopped or collapsed (see FANOUT_EXPECTED). */
export function fanoutDropped(p) {
  if (p.answers < FANOUT_MIN_ANSWERS) return false;
  if (FANOUT_EXPECTED.includes(p.platform) && p.withFanout === 0) return true;
  return (
    p.baselineAnswers >= FANOUT_MIN_ANSWERS &&
    p.baselineRate != null &&
    p.baselineRate >= FANOUT_MIN_BASELINE &&
    (p.rate ?? 0) < p.baselineRate * FANOUT_DROP_RATIO
  );
}

/** A share as a whole percent; a small non-zero one says so rather than "0%". */
const percent = (rate) =>
  rate == null ? '–' : rate > 0 && rate < 0.01 ? '<1%' : `${Math.round(rate * 100)}%`;

async function section(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.error({ err, section: name }, '[health] check failed');
    return { error: err.message };
  }
}

export async function collectHealthReport(now = Date.now()) {
  const probes = await section('probes', runProbes);
  const nightly = await section('nightly', () => checkNightlyRuns(now));
  const cloro = await section('cloro', () => checkCloro(now));
  const fanout = await section('fanout', () => checkFanout(now));
  return {
    generatedAt: new Date(now).toISOString(),
    serverUptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
    probes,
    nightly,
    cloro,
    fanout,
  };
}

/** Problems worth a person's attention, as short lines. Empty means all clear. */
export function findIssues(report) {
  const issues = [];
  const { probes, nightly, cloro } = report;

  if (probes.error) issues.push(`Read probes could not run: ${probes.error}`);
  for (const r of probes.results ?? []) {
    if (r.status === 'green') continue;
    const window = r.days == null ? 'all time' : `${r.days}d`;
    issues.push(
      r.seconds == null
        ? `${r.probe} (${window}) failed: ${r.error}`
        : `${r.probe} (${window}) took ${r.seconds}s of its ${READ_BUDGET_S}s budget`,
    );
  }

  if (nightly.error) issues.push(`Nightly runs could not be checked: ${nightly.error}`);
  if (nightly.failed?.length) issues.push(`${nightly.failed.length} nightly run(s) failed`);
  if (nightly.stuck?.length) issues.push(`${nightly.stuck.length} nightly run(s) stuck`);
  if (nightly.missing?.length) {
    issues.push(`${nightly.missing.length} brand(s) had no completed nightly run`);
  }

  if (cloro.error) issues.push(`Cloro tasks could not be checked: ${cloro.error}`);
  if (cloro.pendingOverAnHour > 0) {
    issues.push(`${cloro.pendingOverAnHour} Cloro task(s) pending for over an hour`);
  }

  // Reports from before the fan-out section have none.
  const fanout = report.fanout ?? {};
  if (fanout.error) issues.push(`Query fan-out could not be checked: ${fanout.error}`);
  for (const p of (fanout.platforms ?? []).filter(fanoutDropped)) {
    issues.push(
      p.withFanout === 0
        ? `${p.platform} returned no query fan-out on any of its ${p.answers} answers ` +
            `in the last 24h (${percent(p.baselineRate)} the days before) — check what Cloro returns`
        : `${p.platform} query fan-out fell to ${percent(p.rate)} of answers ` +
            `(${percent(p.baselineRate)} the days before) — check what Cloro returns`,
    );
  }
  return issues;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_COLOR = { green: '#059669', yellow: '#d97706', red: '#dc2626' };

function fanoutTable(fanout) {
  if (!fanout) return '<p>Not checked.</p>';
  if (fanout.error) return `<p>Could not check: ${escapeHtml(fanout.error)}</p>`;
  const rows = (fanout.platforms ?? [])
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.platform)}</td>` +
        `<td style="${fanoutDropped(p) ? 'color:#dc2626;font-weight:600;' : ''}">${percent(p.rate)} ` +
        `(${p.withFanout} / ${p.answers})</td><td>${percent(p.baselineRate)}</td></tr>`,
    )
    .join('');
  return rows
    ? `<table cellpadding="4" style="border-collapse:collapse;"><tr><th align="left">Platform</th><th align="left">Last 24h</th><th align="left">${BASELINE_DAYS} days before</th></tr>${rows}</table>`
    : '<p>No answers.</p>';
}

export function renderHealthEmail(report) {
  const issues = findIssues(report);
  const date = report.generatedAt.slice(0, 10);
  const subject = `${issues.length ? '[ISSUES]' : '[OK]'} Ansvisor daily health — ${date}`;

  const list = (items) =>
    items.length
      ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
      : '<p>None.</p>';

  const probeRows = (report.probes.results ?? [])
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.probe)}</td><td>${r.days == null ? 'all' : `${r.days}d`}</td>` +
        `<td style="color:${STATUS_COLOR[r.status]};font-weight:600;">${
          r.seconds == null ? 'error' : `${r.seconds}s`
        }</td></tr>`,
    )
    .join('');
  const probes = report.probes.skipped
    ? `<p>Skipped: ${escapeHtml(report.probes.skipped)}</p>`
    : `<table cellpadding="4" style="border-collapse:collapse;">${probeRows}</table>`;

  const n = report.nightly;
  const counts = Object.entries(n.counts ?? {})
    .map(([status, count]) => `${escapeHtml(status)}: ${count}`)
    .join(', ');

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111827;">
  <h2 style="margin:0 0 8px 0;">${issues.length ? 'Needs attention' : 'All clear'}</h2>
  ${list(issues)}
  <h3>Page reads (budget ${READ_BUDGET_S}s, warn at ${WARN_AT_S}s)</h3>
  ${probes}
  <h3>Nightly tracking (last 24h)</h3>
  <p>${counts || 'No nightly jobs.'}</p>
  <p>Failed:</p>${list((n.failed ?? []).map((f) => `${f.brand}: ${f.reason ?? 'no reason'}`))}
  <p>Stuck:</p>${list((n.stuck ?? []).map((s) => `${s.brand} (${s.status})`))}
  <p>No completed run:</p>${list(n.missing ?? [])}
  <p>Runs failed by a server restart: ${n.restartKills ?? 0}</p>
  <h3>Query fan-out (answers with observed sub-queries)</h3>
  ${fanoutTable(report.fanout)}
  <h3>Server</h3>
  <p>Uptime: ${report.serverUptimeHours}h. Cloro tasks pending over an hour: ${
    report.cloro.pendingOverAnHour ?? 'unknown'
  }.</p>
</div>`;

  return { subject, html, issues };
}

/** Collect, render and send. Returns the report with its issues. */
export async function sendHealthReport() {
  const report = await collectHealthReport();
  const { subject, html, issues } = renderHealthEmail(report);
  const to = (process.env.HEALTH_REPORT_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sent = to.length ? await sendEmail({ to, subject, html }) : false;
  logger.info({ issues: issues.length, sent }, '[health] daily report');
  return { ...report, issues, sent };
}
