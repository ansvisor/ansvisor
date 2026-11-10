import supabaseAdmin from '../../config/supabase.js';
import { webAppOrigin } from '../chat-agents.js';
import logger from '../logger.js';
import { appUrl } from '../pulse/engine.js';
import { suggestionMessage } from './blocks/suggestion.js';
import { brandSlack } from './connection.js';
import { deliverToSlack } from './deliver.js';

/**
 * The daily suggestion in a brand's Slack channel (#2139, N5). Suggestions
 * are each person's (W2-24, chat-suggestions/job.js): the channel gets one a
 * day for the brand (owner, 2026-11-10), posted when the job writes the
 * brand's first suggestions of the day (the earliest morning among its
 * people): the action most of them were suggested then, ties by its rank
 * (priority score with the wait lift), then by how long it has waited.
 *
 * Once a day: no other one while one was sent in the last COOLDOWN_HOURS (a
 * later morning, in another time zone, the same day), and one per UTC day by
 * its dedupe key (deliver.js). Its words are the Action Center's own: the
 * web words the action (POST /api/internal/slack/suggestion, CRON_SECRET);
 * when it can't, nothing is posted and the next hour's run tries again.
 * Never throws.
 */

/** Hours after a posted suggestion before the brand's next. */
export const COOLDOWN_HOURS = 20;
const HOUR_MS = 3_600_000;
const WORDS_TIMEOUT_MS = 15_000;

/** The action the most people got; ties by its rank, then by its wait. */
export function brandPick(picks) {
  const byAction = new Map();
  for (const entry of picks) {
    const id = entry.action.id;
    const seen = byAction.get(id) ?? { ...entry, people: 0 };
    seen.people += 1;
    byAction.set(id, seen);
  }
  return (
    [...byAction.values()].sort(
      (a, b) =>
        b.people - a.people ||
        (b.pick.score ?? 0) - (a.pick.score ?? 0) ||
        (b.pick.wait?.days ?? 0) - (a.pick.wait?.days ?? 0) ||
        String(a.action.id).localeCompare(String(b.action.id)),
    )[0] ?? null
  );
}

/**
 * The action's title and description as the Action Center words them, from
 * the web app; throws when it can't say.
 */
export async function actionWords(actionId, { fetchImpl = fetch, env = process.env } = {}) {
  const secret = env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set: the suggestion cannot be worded');
  const res = await fetchImpl(`${webAppOrigin()}/api/internal/slack/suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ actionId }),
    signal: AbortSignal.timeout(WORDS_TIMEOUT_MS),
  });
  if (!res.ok)
    throw Object.assign(new Error('The suggestion was not worded'), { status: res.status });
  const body = await res.json();
  if (typeof body?.title !== 'string' || !body.title) throw new Error('No title came back');
  return {
    title: body.title,
    description: typeof body.description === 'string' ? body.description : '',
  };
}

/** Whether a suggestion was posted for the brand in the last COOLDOWN_HOURS. */
async function postedLately(brandId, now) {
  const { count, error } = await supabaseAdmin
    .from('slack_posts')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('kind', 'suggestion')
    .eq('status', 'sent')
    .gte('created_at', new Date(now.getTime() - COOLDOWN_HOURS * HOUR_MS).toISOString());
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * Posts the brand's suggestion of the day, when its channel gets them.
 * What became of it: { status: 'sent'|'skipped'|'failed', reason? }.
 * @param {{ orgId: string, brandId: string,
 *   picks: Array<{ action: object, pick: { score: number, wait: { days: number } } }>, now: Date }} input
 * @param {{ deliver?: typeof deliverToSlack, words?: typeof actionWords }} [deps]
 */
export async function postDailySuggestion(
  { orgId, brandId, picks, now },
  { deliver = deliverToSlack, words = actionWords } = {},
) {
  try {
    const chosen = brandPick(picks);
    if (!chosen) return { status: 'skipped', reason: 'none' };
    const slack = await brandSlack(brandId);
    if (
      slack?.status !== 'connected' ||
      !slack.settings.channel ||
      !slack.settings.send.suggestion
    ) {
      return { status: 'skipped', reason: 'not_posting' };
    }
    if (await postedLately(brandId, now)) return { status: 'skipped', reason: 'posted_today' };
    const { data: brand, error } = await supabaseAdmin
      .from('brands')
      .select('id, name, organization_id, is_demo')
      .eq('id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brand || brand.organization_id !== orgId) return { status: 'skipped', reason: 'no_brand' };

    let text;
    try {
      text = await words(chosen.action.id);
    } catch (err) {
      logger.warn(
        { brandId, kind: 'suggestion', code: err?.status ?? err?.name ?? null },
        '[slack] suggestion not worded, the next run tries again',
      );
      return { status: 'skipped', reason: 'not_worded' };
    }
    return await deliver({
      brand,
      kind: 'suggestion',
      dedupeKey: `suggestion:${now.toISOString().slice(0, 10)}`,
      message: suggestionMessage({
        brandName: brand.name,
        actionId: chosen.action.id,
        words: text,
        priorityLevel: chosen.action.priority_level ?? null,
        category: chosen.action.category ?? null,
        waitDays: chosen.pick.wait?.days ?? 0,
        appUrl: appUrl(),
      }),
    });
  } catch (err) {
    logger.error(
      { brandId, err: { name: err?.name, code: err?.code ?? null } },
      '[slack] daily suggestion failed',
    );
    return { status: 'failed', code: 'error' };
  }
}
