import supabaseAdmin from '../../config/supabase.js';
import { selectInChunks } from '../chunked-in.js';
import { readAllRpcRows } from '../rpc-pages.js';
import { earnOrPay } from './decision.js';
import { intentClass } from './intent.js';

/**
 * Each buying-intent prompt's standing (ADS-01 §2, §3.2) and the earn-or-pay
 * rule's decision for it. Read with the service role from the detectors'
 * rollup reads (ae_prompt_stats, ae_competitor_prompt_stats,
 * ae_competitor_positions) and the brand's prompts, volumes, topics and
 * competitors, always by the brand and its organization: a brand outside
 * the organization reads as not found.
 *
 * - Cited: one of our pages cited in its answers on a day of the period.
 * - Our position: the best AI names us at where a competitor is level or
 *   ahead (all ae_competitor_positions lists); null elsewhere.
 * - Leader: the competitor named before us, or without us, at the best
 *   position; else us when AI names us; else the competitor named in the
 *   most answers; else none.
 * - Volume: the largest total_google_volume of the prompt's rows, with that
 *   row's est_ai_volume (AI prompts a month, estimated from it); the intent
 *   is the newest row's. Paid isn't measured yet (null), and the rule says so.
 */

export const ADS_PERIODS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });

const isoDay = (now, daysAgo) =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export class NotFound extends Error {
  status = 404;
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data ?? [];
};
const rpc = async (name, params) => must(await supabaseAdmin.rpc(name, params), name);

/** The first of `rows` in the order `compare` sorts them. */
const first = (rows, compare) => rows.reduce((a, b) => (a && compare(a, b) <= 0 ? a : b), null);

/** Rows by their prompt_id. */
function byPrompt(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.prompt_id, [...(map.get(row.prompt_id) ?? []), row]);
  return map;
}

/**
 * @param {{ brandId: string, orgId: string, period?: string, thresholds?: object, now?: Date }} input
 * @returns {Promise<{ rows: object[], notAnalysed: number }>}
 */
export async function readStanding({ brandId, orgId, period, thresholds, now = new Date() }) {
  const days = ADS_PERIODS[period] ?? ADS_PERIODS['30d'];
  const window = {
    p_brand_id: brandId,
    p_cur_from: isoDay(now, days - 1),
    p_cur_to: isoDay(now, 0),
    p_prev_from: isoDay(now, 2 * days - 1),
    p_prev_to: isoDay(now, days),
  };
  const brands = supabaseAdmin.from('brands').select('id').eq('id', brandId);
  if (!must(await brands.eq('organization_id', orgId).maybeSingle(), 'brand')?.id) {
    throw new NotFound('Brand not found');
  }

  const ofBrand = (table) =>
    supabaseAdmin
      .from(table)
      .select('id, name')
      .eq('brand_id', brandId)
      .then((res) => must(res, table));
  const [prompts, topics, competitors, stats, named] = await Promise.all([
    readAllRpcRows('prompts', (from, to) =>
      supabaseAdmin
        .from('prompts')
        .select(
          'id, text, topic_id, platforms, regions, prompt_sets!inner(brand_id, brands!inner(organization_id))',
        )
        .eq('prompt_sets.brand_id', brandId)
        .eq('prompt_sets.brands.organization_id', orgId)
        .eq('is_active', true)
        .order('id')
        .range(from, to),
    ).then((res) => must(res, 'prompts')),
    ofBrand('topics'),
    ofBrand('competitors'),
    rpc('ae_prompt_stats', window),
    rpc('ae_competitor_prompt_stats', window),
  ]);

  const volumes = await selectInChunks(
    prompts.map((p) => p.id),
    (ids) =>
      supabaseAdmin
        .from('prompt_volumes')
        .select('prompt_id, intent, total_google_volume, est_ai_volume')
        .in('prompt_id', ids)
        .order('fetched_at', { ascending: false }),
  );
  const demand = new Map();
  for (const v of must(volumes, 'prompt_volumes')) {
    const volume = v.total_google_volume == null ? null : Number(v.total_google_volume);
    const estAi = volume === null || v.est_ai_volume == null ? null : Number(v.est_ai_volume);
    const known = demand.get(v.prompt_id) ?? { intent: v.intent, volume, estAi };
    if (volume !== null && !(known.volume >= volume)) Object.assign(known, { volume, estAi });
    demand.set(v.prompt_id, known);
  }

  const kinds = prompts.map((p) => intentClass(demand.get(p.id)?.intent, thresholds));
  const notAnalysed = kinds.filter((kind) => kind === 'not_analysed').length;
  const buying = prompts.filter((_, i) => kinds[i] === 'buying');
  if (buying.length === 0) return { rows: [], notAnalysed };
  const positions = competitors.length
    ? await rpc('ae_competitor_positions', {
        ...window,
        p_competitor_ids: competitors.map((c) => c.id),
        p_limit: Math.min(20_000, prompts.length * 8),
      })
    : [];

  const statsOf = new Map(stats.map((s) => [s.prompt_id, s]));
  const [namedOf, positionsOf] = [byPrompt(named), byPrompt(positions)];
  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const competitorName = new Map(competitors.map((c) => [String(c.id), c.name]));

  const rows = buying.map((p) => {
    const s = statsOf.get(p.id) ?? {};
    const answersOf = new Map(
      (namedOf.get(p.id) ?? []).map((n) => [String(n.competitor_id), Number(n.cur_answers) || 0]),
    );
    const seen = positionsOf.get(p.id) ?? [];
    const ours = seen.filter((r) => r.brand_now != null).map((r) => Number(r.brand_now));
    const rival = first(
      seen.filter((r) => r.brand_now == null || Number(r.competitor_now) < Number(r.brand_now)),
      (a, b) =>
        a.competitor_now - b.competitor_now ||
        (answersOf.get(String(b.competitor_id)) ?? 0) -
          (answersOf.get(String(a.competitor_id)) ?? 0),
    );
    const mostNamed = first(
      [...answersOf].filter(([, n]) => n > 0),
      (a, b) => b[1] - a[1],
    );
    const weNamed = Number(s.cur_mention_days) > 0;
    const leader = rival
      ? String(rival.competitor_id)
      : weNamed
        ? 'us'
        : (mostNamed?.[0] ?? 'none');
    const standing = {
      weCited: Number(s.cur_citation_days) > 0,
      ourPosition: ours.length ? Math.min(...ours) : null,
      leader,
      rivalPays: null,
      wePay: null,
      volume: demand.get(p.id)?.volume ?? null,
      engines: p.platforms ?? [],
    };
    return {
      promptId: p.id,
      text: p.text,
      topic: p.topic_id ? { id: p.topic_id, name: topicName.get(p.topic_id) ?? null } : null,
      intent: demand.get(p.id).intent,
      platforms: p.platforms ?? [],
      regions: p.regions ?? [],
      answers: Number(s.cur_answers) || 0,
      estAiVolume: demand.get(p.id).estAi,
      weNamed,
      leaderName: competitorName.get(leader) ?? null,
      standing,
      ...earnOrPay(standing, thresholds),
    };
  });
  return { rows, notAnalysed };
}
