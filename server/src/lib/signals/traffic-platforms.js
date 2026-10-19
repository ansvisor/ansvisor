/**
 * "A new AI platform starts sending visits" (AT-013, spec §3.8).
 *
 * A platform with AI visits in the last seven whole days and none before
 * them, counted as the AI Traffic page counts them (ai_traffic_merged, 00176:
 * the snippet on the days it ran, Analytics on the rest). A brand with no AI
 * visits before the week has nothing to compare with — every platform would
 * be new — so it gets none.
 *
 * Only a source on the list (ai-sources.json) with NEW_PLATFORM_MIN_VISITS
 * or more visits: the beacon is public, so a made-up source key or one stray
 * visit would otherwise raise it.
 *
 * Good news with no work behind it, so it is a recorder kind of its own
 * (`ai_platform_new`, like `new_engine`) and no definition reads it. It is an
 * event: it stays until someone reads it, and a later week can't raise it
 * again because the platform is no longer new.
 */

import supabaseAdmin from '../../config/supabase.js';
import { AI_SOURCES } from '../ai-sources.js';
import { logger } from '../logger.js';
import { analyticsDayCount } from './library/classify.js';

const DAY_MS = 86_400_000;

/** Visits in the week a platform needs before it counts as new. */
export const NEW_PLATFORM_MIN_VISITS = 3;

const KNOWN_SOURCES = new Set(AI_SOURCES.map((source) => source.key));

/** The second before `iso`: see detect.js lastSecond. */
function lastSecond(iso) {
  return new Date(Date.parse(iso) - 1000).toISOString();
}

/** Midnight UTC `daysAgo` days before today's. */
function utcMidnight(now, daysAgo) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - daysAgo * DAY_MS).toISOString();
}

/**
 * The platforms new this week, most visits first: the merged reads of the
 * week and of everything before it. `unknown` is a referrer the source list
 * couldn't name, not a platform.
 */
export function newPlatforms(week, before) {
  if ((Number(before?.visits) || 0) === 0) return [];
  const earlier = new Set(
    (before?.platforms ?? [])
      .filter((p) => (Number(p.visits) || 0) > 0)
      .map((p) => String(p.platform)),
  );
  const firstDay = new Map();
  for (const d of week?.days ?? []) {
    if ((Number(d.visits) || 0) === 0) continue;
    const day = String(d.day).slice(0, 10);
    const known = firstDay.get(d.platform);
    if (!known || day < known) firstDay.set(d.platform, day);
  }
  return (week?.platforms ?? [])
    .map((p) => ({ platform: String(p.platform ?? ''), visits: Number(p.visits) || 0 }))
    .filter((p) => p.visits >= NEW_PLATFORM_MIN_VISITS && KNOWN_SOURCES.has(p.platform))
    .filter((p) => !earlier.has(p.platform))
    .map((p) => ({ ...p, firstDay: firstDay.get(p.platform) ?? null }))
    .sort((a, b) => b.visits - a.visits || a.platform.localeCompare(b.platform));
}

async function merged(brandId, from, to) {
  const { data, error } = await supabaseAdmin.rpc('ai_traffic_merged', {
    p_brand_id: brandId,
    p_from: from,
    p_to: lastSecond(to),
    p_to_inclusive: true,
    p_analytics: true,
  });
  if (error) throw new Error(error.message);
  return data ?? {};
}

/**
 * Signal candidates for the platforms that started sending AI visits this
 * week. Best effort: a failed read costs this finding for the night, never
 * the pass, and an event kind is never closed for being unread.
 */
export async function newAiPlatformCandidates(brandId, { now = new Date() } = {}) {
  try {
    const weekStart = utcMidnight(now, 7);
    const [week, before] = await Promise.all([
      merged(brandId, weekStart, utcMidnight(now, 0)),
      merged(brandId, null, weekStart),
    ]);
    const analytics = analyticsDayCount(week.analytics_days) > 0;
    return newPlatforms(week, before).map((p) => ({
      kind: 'ai_platform_new',
      dedupKey: `ai_platform_new:${p.platform}`,
      source: analytics ? ['ga4'] : ['ai_results'],
      // Not `platform`: on a signal that names a tracked engine, where its
      // prompts run (web signals/where.ts). This is a referrer's source key.
      payload: { aiSource: p.platform, firstDay: p.firstDay },
      previousValue: 0,
      currentValue: p.visits,
      changeValue: p.visits,
    }));
  } catch (err) {
    logger.error({ err, brandId }, '[signals] new AI platform read failed');
    return [];
  }
}
