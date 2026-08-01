import supabaseAdmin from '../../config/supabase.js';
import { computeAiVisibilityScore } from '../../config/visibility-score.js';

/**
 * Daily Pulse metric computation (#540).
 *
 * Everything here reads through the same RPCs the Insights dashboard uses
 * (visible_prompt_stats, tracked_prompt_count, insights_aggregates,
 * competitor_aggregates, prompt_performance_aggregates) with the same
 * rounding, so the email and the dashboard always agree for the same
 * window. Pure computation — no sending, no persistence.
 */

const DAY_MS = 86_400_000;

// Detector thresholds (issue #540 v1 scope).
const DROP_MIN_POINTS = 15;
const DROP_MIN_RELATIVE = 0.3;
const DROP_MIN_PROMPTS = 10;
const SURGE_MIN_POINTS = 15;
const LOST_CITED_RATIO = 0.6;
const LOST_CONSECUTIVE_DAYS = 3;
const MOVER_MIN_GAIN = 5;
const MOVER_LIMIT = 3;
// A platform is considered degraded (data-collection incident, not a real
// visibility change) when its result volume across ALL orgs collapses below
// this fraction of its trailing 7-day daily average.
const OUTAGE_COLLAPSE_RATIO = 0.25;
const OUTAGE_MIN_BASELINE = 20;

// Cloro scraper platforms, as stored in prompt_results.platform. Keep in
// sync with SCRAPER_TASK_TYPES in ../cloro-scraper.js (minus shopping,
// which is excluded from Insights per #155).
const TRACKED_PLATFORMS = [
  'chatgpt-web',
  'google-aio',
  'google-aimode',
  'copilot-web',
  'grok-web',
  'perplexity-web',
  'gemini-web',
];

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function rpc(name, params) {
  const { data, error } = await supabaseAdmin.rpc(name, params);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function visibilityRate(brandId, from, to) {
  const params = {
    p_brand_id: brandId,
    p_date_from: from.toISOString(),
    p_date_to: to.toISOString(),
  };
  const [stats, tracked, vis] = await Promise.all([
    rpc('visible_prompt_stats', params),
    rpc('tracked_prompt_count', params),
    rpc('ai_visibility_aggregates', params),
  ]);
  const visible = stats?.visible_prompts ?? 0;
  const total = tracked ?? 0;
  // `rate` carries the AI Visibility Score (0-100) — the same blend every
  // dashboard surface shows; coverage stays available as visible/total.
  const score =
    computeAiVisibilityScore({
      answers: vis?.answers ?? 0,
      mentionAnswers: vis?.mention_answers ?? 0,
      citationAnswers: vis?.citation_answers ?? 0,
      positionFactor: vis?.position_factor ?? null,
    }) ?? 0;
  return { visible, total, rate: score };
}

async function insightsWindow(brandId, from, to) {
  const agg = await rpc('insights_aggregates', {
    p_brand_id: brandId,
    p_date_from: from.toISOString(),
    p_date_to: to.toISOString(),
  });
  const mentioning = agg?.mentioning_results ?? 0;
  return {
    totalResults: agg?.total_results ?? 0,
    mentions: agg?.total_mentions ?? 0,
    citations: agg?.total_citations ?? 0,
    sentimentPct: mentioning > 0 ? Math.round(((agg?.positive_count ?? 0) / mentioning) * 100) : 0,
  };
}

async function competitorRates(brandId, from, to) {
  const agg = await rpc('ai_visibility_aggregates', {
    p_brand_id: brandId,
    p_date_from: from.toISOString(),
    p_date_to: to.toISOString(),
  });
  // Shared denominator (the brand's answers), same as the web leaderboard.
  const answers = agg?.answers ?? 0;
  const brandRate =
    computeAiVisibilityScore({
      answers,
      mentionAnswers: agg?.mention_answers ?? 0,
      citationAnswers: agg?.citation_answers ?? 0,
      positionFactor: agg?.position_factor ?? null,
    }) ?? 0;
  const competitors = new Map();
  for (const c of agg?.by_competitor ?? []) {
    competitors.set(c.competitor_id, {
      id: c.competitor_id,
      name: c.name,
      rate:
        computeAiVisibilityScore({
          answers,
          mentionAnswers: c.mention_answers ?? 0,
          citationAnswers: c.citation_answers ?? 0,
          positionFactor: c.position_factor ?? null,
        }) ?? 0,
    });
  }
  return { brandRate, competitors };
}

/** Per-prompt AI Visibility Score over a window (movers highlight). */
async function promptScores(brandId, from, to) {
  const rows = await rpc('prompt_visibility_summaries', {
    p_brand_id: brandId,
    p_date_from: from.toISOString(),
    p_date_to: to.toISOString(),
  });
  const map = new Map();
  for (const row of rows ?? []) {
    if (!row.runs) continue;
    map.set(row.prompt_id, {
      score:
        computeAiVisibilityScore({
          answers: Number(row.runs),
          mentionAnswers: Number(row.mention_answers ?? 0),
          citationAnswers: Number(row.citation_answers ?? 0),
          positionFactor: row.position_factor ?? null,
        }) ?? 0,
    });
  }
  return map;
}

/** All prompt ids (and texts) belonging to a brand. */
async function brandPrompts(brandId) {
  const { data: sets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  const setIds = (sets ?? []).map((s) => s.id);
  if (!setIds.length) return [];
  const { data: prompts } = await supabaseAdmin
    .from('prompts')
    .select('id, text')
    .in('prompt_set_id', setIds);
  return prompts ?? [];
}

/** Target URLs cited for the first time inside the window. */
async function firstTimeCitations(promptById, from) {
  const promptIds = [...promptById.keys()];
  if (!promptIds.length) return [];
  const { data } = await supabaseAdmin
    .from('prompt_target_urls')
    .select('url, label, prompt_id, first_cited_at')
    .in('prompt_id', promptIds)
    .gte('first_cited_at', from.toISOString())
    .order('first_cited_at', { ascending: false })
    .limit(5);
  return (data ?? []).map((row) => ({
    url: row.url,
    label: row.label,
    promptText: promptById.get(row.prompt_id)?.text ?? '',
  }));
}

/** Platforms where the brand became visible for the first time ever. */
async function newEngineAppearances(brandId, from) {
  const { data: recent } = await supabaseAdmin
    .from('prompt_results')
    .select('platform')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .gte('created_at', from.toISOString())
    .or('mention_count.gt.0,citation_count.gt.0')
    .limit(1000);
  const platforms = [...new Set((recent ?? []).map((r) => r.platform).filter(Boolean))];
  const firsts = [];
  for (const platform of platforms) {
    const { count } = await supabaseAdmin
      .from('prompt_results')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('platform', platform)
      .lt('created_at', from.toISOString())
      .or('mention_count.gt.0,citation_count.gt.0');
    if (!count) firsts.push(platform);
  }
  return firsts;
}

/**
 * High-volume prompts that stopped being cited: cited on >= 60% of the
 * days with results over the last 14 days, but 0 citations on the most
 * recent 3 result-days. "Runs" are bucketed per UTC day because a daily
 * run inserts one row per platform.
 */
async function lostCitationPrompts(brandId, promptById, now) {
  const promptIds = [...promptById.keys()];
  if (!promptIds.length) return [];
  const { data: volumes } = await supabaseAdmin
    .from('prompt_volumes')
    .select('prompt_id')
    .in('prompt_id', promptIds)
    .gt('est_ai_volume', 0);
  const volumeIds = (volumes ?? []).map((v) => v.prompt_id);
  if (!volumeIds.length) return [];

  const since = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const PAGE = 1000;
  const rows = [];
  for (let pageStart = 0; pageStart < 20000; pageStart += PAGE) {
    const { data: page, error } = await supabaseAdmin
      .from('prompt_results')
      .select('prompt_id, citation_count, created_at')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .in('prompt_id', volumeIds)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(pageStart, pageStart + PAGE - 1);
    if (error) throw new Error(`lost-citations scan failed: ${error.message}`);
    rows.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
  }

  const byPrompt = new Map();
  for (const row of rows) {
    if (!row.prompt_id) continue;
    const day = row.created_at.slice(0, 10);
    const days = byPrompt.get(row.prompt_id) ?? new Map();
    days.set(day, (days.get(day) ?? false) || (row.citation_count ?? 0) > 0);
    byPrompt.set(row.prompt_id, days);
  }

  const lost = [];
  for (const [promptId, days] of byPrompt) {
    const ordered = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (ordered.length < LOST_CONSECUTIVE_DAYS + 2) continue;
    const tail = ordered.slice(-LOST_CONSECUTIVE_DAYS);
    if (tail.some(([, cited]) => cited)) continue;
    const head = ordered.slice(0, -LOST_CONSECUTIVE_DAYS);
    const citedDays = head.filter(([, cited]) => cited).length;
    if (citedDays / head.length >= LOST_CITED_RATIO) {
      lost.push({ promptId, promptText: promptById.get(promptId)?.text ?? '' });
    }
  }
  return lost;
}

/**
 * Platform-outage guard: platforms whose result volume across ALL orgs
 * collapsed today vs their trailing 7-day daily average — a
 * data-collection incident on our side, not a real visibility change.
 */
async function degradedPlatforms(now) {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const weekAgo = new Date(now.getTime() - 8 * DAY_MS).toISOString();
  const degraded = [];
  for (const platform of TRACKED_PLATFORMS) {
    const [{ count: today }, { count: baseline }] = await Promise.all([
      supabaseAdmin
        .from('prompt_results')
        .select('id', { count: 'exact', head: true })
        .eq('platform', platform)
        .gte('created_at', dayAgo),
      supabaseAdmin
        .from('prompt_results')
        .select('id', { count: 'exact', head: true })
        .eq('platform', platform)
        .gte('created_at', weekAgo)
        .lt('created_at', dayAgo),
    ]);
    const dailyBaseline = (baseline ?? 0) / 7;
    if (
      dailyBaseline >= OUTAGE_MIN_BASELINE &&
      (today ?? 0) < dailyBaseline * OUTAGE_COLLAPSE_RATIO
    ) {
      degraded.push(platform);
    }
  }
  return degraded;
}

/**
 * Compute the full pulse payload for a brand.
 *
 * @param {string} brandId
 * @param {{ windowDays?: number, now?: Date }} [options] windowDays is 1 for
 *   daily pulses, 7 for weekly ones — it stretches the KPI comparison
 *   windows, while the detector windows (7d vs previous 7d, 14d citation
 *   history) stay fixed per the issue spec.
 */
export async function computePulseMetrics(brandId, { windowDays = 1, now = new Date() } = {}) {
  const curFrom = new Date(now.getTime() - windowDays * DAY_MS);
  const prevFrom = new Date(now.getTime() - 2 * windowDays * DAY_MS);
  const weekFrom = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeekFrom = new Date(now.getTime() - 14 * DAY_MS);

  const prompts = await brandPrompts(brandId);
  const promptById = new Map(prompts.map((p) => [p.id, p]));

  const [
    curRate,
    weekRate,
    prevWeekRate,
    curInsights,
    prevInsights,
    weekComp,
    prevWeekComp,
    weekPromptAvg,
    prevWeekPromptAvg,
    firstCited,
    newEngines,
    lostCitations,
    degraded,
  ] = await Promise.all([
    visibilityRate(brandId, curFrom, now),
    visibilityRate(brandId, weekFrom, now),
    visibilityRate(brandId, twoWeekFrom, weekFrom),
    insightsWindow(brandId, curFrom, now),
    insightsWindow(brandId, prevFrom, curFrom),
    competitorRates(brandId, weekFrom, now),
    competitorRates(brandId, twoWeekFrom, weekFrom),
    promptScores(brandId, weekFrom, now),
    promptScores(brandId, twoWeekFrom, weekFrom),
    firstTimeCitations(promptById, curFrom),
    newEngineAppearances(brandId, curFrom),
    lostCitationPrompts(brandId, promptById, now),
    degradedPlatforms(now),
  ]);

  const kpis = {
    visibilityRate: curRate.rate,
    visiblePrompts: curRate.visible,
    promptCount: curRate.total,
    weekRate: weekRate.rate,
    prevWeekRate: prevWeekRate.rate,
    weekTrend: round1(weekRate.rate - prevWeekRate.rate),
    mentions: curInsights.mentions,
    mentionsChange: curInsights.mentions - prevInsights.mentions,
    citations: curInsights.citations,
    citationsChange: curInsights.citations - prevInsights.citations,
    sentimentPct: curInsights.sentimentPct,
    sentimentChange: curInsights.sentimentPct - prevInsights.sentimentPct,
    totalResults: curInsights.totalResults,
  };

  // ── Highlights ─────────────────────────────────────────────────────────
  const highlights = [];
  for (const cite of firstCited) {
    highlights.push({
      type: 'first_citation',
      key: `first_citation:${cite.url}`,
      url: cite.url,
      label: cite.label,
      promptText: cite.promptText,
    });
  }

  const movers = [];
  for (const [promptId, cur] of weekPromptAvg) {
    const prev = prevWeekPromptAvg.get(promptId);
    if (!prev) continue;
    const gain = round1(cur.score - prev.score);
    if (gain >= MOVER_MIN_GAIN) {
      movers.push({ promptId, text: promptById.get(promptId)?.text ?? '', gain });
    }
  }
  movers.sort((a, b) => b.gain - a.gain);
  for (const mover of movers.slice(0, MOVER_LIMIT)) {
    highlights.push({
      type: 'prompt_gain',
      key: `prompt_gain:${mover.promptId}`,
      promptText: mover.text,
      gain: mover.gain,
    });
  }

  for (const [id, comp] of weekComp.competitors) {
    const prev = prevWeekComp.competitors.get(id);
    if (!prev) continue;
    if (prevWeekComp.brandRate <= prev.rate && weekComp.brandRate > comp.rate) {
      highlights.push({
        type: 'competitor_overtaken',
        key: `competitor_overtaken:${id}`,
        competitorName: comp.name,
        brandRate: weekComp.brandRate,
        competitorRate: comp.rate,
      });
    }
  }

  for (const platform of newEngines) {
    highlights.push({ type: 'new_engine', key: `new_engine:${platform}`, platform });
  }

  // ── Warnings ───────────────────────────────────────────────────────────
  const warnings = [];
  const outage = degraded.length > 0;

  const drop = round1(prevWeekRate.rate - weekRate.rate);
  if (
    !outage &&
    weekRate.total >= DROP_MIN_PROMPTS &&
    drop >= DROP_MIN_POINTS &&
    prevWeekRate.rate > 0 &&
    drop / prevWeekRate.rate >= DROP_MIN_RELATIVE
  ) {
    warnings.push({
      type: 'sharp_drop',
      key: 'sharp_drop',
      from: prevWeekRate.rate,
      to: weekRate.rate,
      drop,
    });
  }

  for (const [id, comp] of weekComp.competitors) {
    const prev = prevWeekComp.competitors.get(id);
    if (!prev) continue;
    const surge = round1(comp.rate - prev.rate);
    if (surge >= SURGE_MIN_POINTS) {
      warnings.push({
        type: 'competitor_surge',
        key: `competitor_surge:${id}`,
        competitorName: comp.name,
        from: prev.rate,
        to: comp.rate,
      });
    } else if (prev.rate <= prevWeekComp.brandRate && comp.rate > weekComp.brandRate) {
      warnings.push({
        type: 'competitor_crossed',
        key: `competitor_crossed:${id}`,
        competitorName: comp.name,
        competitorRate: comp.rate,
        brandRate: weekComp.brandRate,
      });
    }
  }

  if (!outage) {
    for (const lost of lostCitations) {
      warnings.push({
        type: 'lost_citations',
        key: `lost_citations:${lost.promptId}`,
        promptText: lost.promptText,
      });
    }
  }

  return {
    windowDays,
    computedAt: now.toISOString(),
    kpis,
    highlights,
    warnings,
    degradedPlatforms: degraded,
  };
}
