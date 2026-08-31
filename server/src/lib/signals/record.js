/**
 * Signal recording (Action Center, observation layer).
 *
 * Converts what the production detectors already find into `signals` rows
 * with a lifecycle. Two inputs, one writer:
 *
 *  - the Daily Pulse metric engine's highlights and warnings (#540) — its
 *    thresholds ARE the noise control: a visibility wobble below the
 *    sharp-drop floor or a one-run citation blip never reaches this module;
 *  - open page-opportunity findings (#719), read from their table.
 *
 * Runs after every stamped daily tracking run, before and independent of the
 * pulse email's own gating — a brand with pulse emails off still gets
 * signals, because the observation layer is a product surface, not a
 * notification preference.
 *
 * Dedup: one row per ongoing condition, keyed by (brand, dedup_key). A
 * re-detection updates last_detected_at and the measured values. A RESOLVED
 * condition that fires again reopens as new; a DISMISSED one stays dismissed
 * — the user said "not relevant", and re-raising it nightly would teach them
 * to ignore the page.
 *
 * Resolution: persistent kinds (a drop, a surge, an open opportunity) are
 * auto-resolved when a run no longer detects them — the condition ended.
 * Event kinds (a first citation, a new engine appearance) describe moments;
 * they never auto-resolve and simply age until triaged.
 */

import supabaseAdmin from '../../config/supabase.js';
import { computePulseMetrics } from '../pulse/metrics.js';
import { logger } from '../logger.js';

const DETECTION_WINDOW_DAYS = 7;

/**
 * Static knowledge per detector kind. Mirrored by the web registry
 * (web/src/lib/signals/registry.ts) which owns the display templates —
 * this side owns what gets STORED: category, impact, sources, KPI links,
 * and whether the condition persists.
 */
const KIND_META = {
  sharp_drop: {
    category: 'visibility',
    impact: 'high',
    kpiKeys: ['ai_visibility'],
    persistent: true,
  },
  prompt_gain: {
    category: 'visibility',
    impact: 'medium',
    kpiKeys: ['ai_visibility'],
    persistent: false,
  },
  new_engine: {
    category: 'visibility',
    impact: 'medium',
    kpiKeys: ['ai_visibility'],
    persistent: false,
  },
  lost_citations: {
    category: 'citation',
    impact: 'high',
    kpiKeys: ['citations'],
    persistent: true,
  },
  first_citation: {
    category: 'citation',
    impact: 'medium',
    kpiKeys: ['citations'],
    persistent: false,
  },
  competitor_surge: {
    category: 'competitor',
    impact: 'high',
    kpiKeys: ['share_of_voice'],
    persistent: true,
  },
  competitor_crossed: {
    category: 'competitor',
    impact: 'high',
    kpiKeys: ['share_of_voice', 'ai_visibility'],
    persistent: true,
  },
  competitor_overtaken: {
    category: 'competitor',
    impact: 'medium',
    kpiKeys: ['share_of_voice'],
    persistent: false,
  },
  page_opportunity: {
    category: 'traffic',
    impact: 'medium',
    kpiKeys: ['ai_referral_traffic'],
    persistent: true,
  },
};

/** Pulse highlight/warning → signal candidate. Returns null for entries that
 *  describe engine health rather than the brand (degraded platforms). */
function fromPulseEntry(entry) {
  const meta = KIND_META[entry.type];
  if (!meta) return null;

  const candidate = {
    kind: entry.type,
    dedupKey: entry.key,
    source: ['ai_results'],
    payload: {},
    previousValue: null,
    currentValue: null,
    changeValue: null,
  };

  switch (entry.type) {
    case 'sharp_drop':
      candidate.previousValue = entry.from;
      candidate.currentValue = entry.to;
      candidate.changeValue = -entry.drop;
      break;
    case 'prompt_gain':
      candidate.payload = { promptText: entry.promptText };
      candidate.changeValue = entry.gain;
      break;
    case 'new_engine':
      candidate.payload = { platform: entry.platform };
      break;
    case 'lost_citations':
      candidate.payload = { promptText: entry.promptText };
      break;
    case 'first_citation':
      candidate.payload = { url: entry.url, label: entry.label, promptText: entry.promptText };
      break;
    case 'competitor_surge':
      candidate.payload = { competitorName: entry.competitorName };
      candidate.previousValue = entry.from;
      candidate.currentValue = entry.to;
      candidate.changeValue = Math.round((entry.to - entry.from) * 10) / 10;
      break;
    case 'competitor_crossed':
    case 'competitor_overtaken':
      candidate.payload = {
        competitorName: entry.competitorName,
        competitorRate: entry.competitorRate,
        brandRate: entry.brandRate,
      };
      break;
    default:
      return null;
  }
  return candidate;
}

/** Open page-opportunity findings → signal candidates. */
async function pageOpportunityCandidates(brandId) {
  const { data, error } = await supabaseAdmin
    .from('page_opportunities')
    .select('landing_page, value_signal, value_rank, sessions, citation_state')
    .eq('brand_id', brandId)
    .is('resolved_at', null)
    .limit(1000);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    kind: 'page_opportunity',
    dedupKey: `page_opportunity:${row.landing_page}`,
    source: ['ga4', 'ai_results'],
    payload: {
      landingPage: row.landing_page,
      valueSignal: row.value_signal,
      valueRank: row.value_rank,
      citationState: row.citation_state,
    },
    previousValue: null,
    currentValue: row.sessions,
    changeValue: null,
  }));
}

/**
 * Detect and record signals for one brand. Best-effort by contract: callers
 * fire-and-forget, and a failure here must never affect the tracking run.
 */
export async function recordSignalsForBrand(brandId, { now = new Date() } = {}) {
  const metrics = await computePulseMetrics(brandId, {
    windowDays: DETECTION_WINDOW_DAYS,
    now,
  });

  // No fresh results means the detectors saw nothing, not that every
  // condition ended — recording now would silently auto-resolve real
  // signals. Same for a platform outage, during which the engine already
  // suppresses drop/loss warnings: absence of a warning is not recovery.
  if ((metrics.kpis?.totalResults ?? 0) === 0) {
    logger.info({ brandId }, '[signals] skipped — no fresh results in window');
    return { skipped: 'no_fresh_results' };
  }
  const outage = (metrics.degradedPlatforms?.length ?? 0) > 0;

  const candidates = [];
  for (const entry of [...(metrics.highlights ?? []), ...(metrics.warnings ?? [])]) {
    const candidate = fromPulseEntry(entry);
    if (candidate) candidates.push(candidate);
  }
  candidates.push(...(await pageOpportunityCandidates(brandId)));

  // Existing rows decide insert vs update vs reopen. A brand's signal set is
  // small (tens), so reading it whole is cheaper than being clever.
  const { data: existingRows, error: readErr } = await supabaseAdmin
    .from('signals')
    .select('id, dedup_key, kind, status')
    .eq('brand_id', brandId)
    .limit(1000);
  if (readErr) throw new Error(readErr.message);
  const existing = new Map((existingRows ?? []).map((row) => [row.dedup_key, row]));

  const nowIso = now.toISOString();
  let inserted = 0;
  let refreshed = 0;
  let reopened = 0;

  for (const candidate of candidates) {
    const meta = KIND_META[candidate.kind];
    const current = existing.get(candidate.dedupKey);

    if (!current) {
      const { error } = await supabaseAdmin.from('signals').insert({
        brand_id: brandId,
        category: meta.category,
        kind: candidate.kind,
        impact: meta.impact,
        source: candidate.source,
        dedup_key: candidate.dedupKey,
        detected_at: nowIso,
        last_detected_at: nowIso,
        previous_value: candidate.previousValue,
        current_value: candidate.currentValue,
        change_value: candidate.changeValue,
        payload: candidate.payload,
        kpi_keys: meta.kpiKeys,
      });
      if (error) throw new Error(error.message);
      inserted += 1;
      continue;
    }

    if (current.status === 'dismissed') continue;

    const patch = {
      last_detected_at: nowIso,
      previous_value: candidate.previousValue,
      current_value: candidate.currentValue,
      change_value: candidate.changeValue,
      payload: candidate.payload,
      updated_at: nowIso,
    };
    if (current.status === 'resolved') {
      // The condition came back: this is a new observation, not a stale one.
      patch.status = 'new';
      patch.detected_at = nowIso;
      patch.resolved_at = null;
      reopened += 1;
    } else {
      refreshed += 1;
    }
    const { error } = await supabaseAdmin.from('signals').update(patch).eq('id', current.id);
    if (error) throw new Error(error.message);
  }

  // Persistent conditions this run no longer detects have ended — close
  // them. Not during an outage: the engine suppresses drop/loss warnings
  // while a platform is degraded, and treating that silence as recovery
  // would close real signals.
  const detectedKeys = new Set(candidates.map((c) => c.dedupKey));
  const toResolve = outage
    ? []
    : (existingRows ?? []).filter(
        (row) =>
          KIND_META[row.kind]?.persistent &&
          (row.status === 'new' || row.status === 'acknowledged') &&
          !detectedKeys.has(row.dedup_key),
      );
  for (const row of toResolve) {
    const { error } = await supabaseAdmin
      .from('signals')
      .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
  }

  const summary = { inserted, refreshed, reopened, autoResolved: toResolve.length };
  logger.info({ brandId, ...summary }, '[signals] recorded');
  return summary;
}
