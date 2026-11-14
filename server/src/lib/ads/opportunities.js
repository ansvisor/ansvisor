import supabaseAdmin from '../../config/supabase.js';
import { adsThresholds } from '../../config/ads.js';
import { getPlan, hasFeature, isCloud } from '../../config/plans.js';
import { logger } from '../logger.js';
import { applyPlanOverrides } from '../plan-guard.js';
import { logAdsActivity } from './activity.js';
import { channelsFor } from './decision.js';
import { NotFound, readStanding } from './standing.js';

/**
 * Ads' Opportunities (ADS-01 §3.2, §8; 00531): each prompt's standing and
 * decision, a person's decision over the rule's, the workspace's thresholds,
 * and each prompt's decision once a week, for "+6 new" and the weekly agent.
 */

/** Starter and the free trial see this many rows, and how many more are locked (§8). */
export const OPEN_ROWS = 3;
/** The page's own period: its read writes the week's snapshot, so weeks compare alike. */
export const SNAPSHOT_PERIOD = '30d';

/** The ISO week of `date` (UTC), as 2026-W46. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

/**
 * Whether the workspace reads every opportunity, as the web's lock has it
 * (dashboard/ads/_ads-view.tsx): ads_read, and not the free trial (an
 * Enterprise deal's trial keeps its plan); the plan it was on once ended.
 * The demo brand reads as Growth does; self-hosted has no plans.
 */
export async function readsEveryOpportunity(orgId, brand) {
  if (!isCloud() || brand?.is_demo) return true;
  const org = must(
    await supabaseAdmin
      .from('organizations')
      .select('plan, subscription_status, plan_overrides')
      .eq('id', orgId)
      .maybeSingle(),
    'organization read',
  );
  if (!org || (org.subscription_status === 'trialing' && org.plan !== 'enterprise')) return false;
  return hasFeature(applyPlanOverrides(getPlan(org.plan), org), 'ads_read');
}

/** The workspace's own thresholds (not the defaults), and who set them last. */
export async function readAdsSettings(orgId) {
  const settings = supabaseAdmin.from('ads_settings').select('thresholds, updated_by, updated_at');
  const row = must(await settings.eq('organization_id', orgId).maybeSingle(), 'ads settings');
  return {
    thresholds: row?.thresholds ?? {},
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Puts a change back (`write` of the row it replaced) when the activity log
 * can't hold it, so nothing changes unlogged. A put-back that fails too is
 * logged here; the caller throws the log's error either way.
 */
async function putBack(write, row, what) {
  const { error } = await write(row);
  if (error) logger.error({ err: error.message }, `[ads] ${what} put-back failed`);
}

/**
 * Lays `changes` over the workspace's thresholds (null takes one back to its
 * default), logged; a change the log can't hold is put back.
 */
export async function saveAdsSettings(orgId, userId, changes) {
  const settings = () => supabaseAdmin.from('ads_settings');
  const write = (row) =>
    row
      ? settings().upsert({ organization_id: orgId, ...row })
      : settings().delete().eq('organization_id', orgId);
  const own = settings().select('thresholds, updated_by, updated_at').eq('organization_id', orgId);
  const was = must(await own.maybeSingle(), 'ads settings');
  const before = was?.thresholds ?? {};
  const thresholds = { ...before };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete thresholds[key];
    else thresholds[key] = value;
  }
  const now = { thresholds, updated_by: userId, updated_at: new Date().toISOString() };
  must(await write(now), 'ads settings write');
  try {
    await logAdsActivity({
      orgId,
      actor: { userId },
      event: 'settings.changed',
      target: { setting: 'thresholds' },
      before,
      after: thresholds,
    });
  } catch (err) {
    await putBack(write, was, 'settings');
    throw err;
  }
  return { thresholds, updatedBy: userId, updatedAt: now.updated_at };
}

/**
 * Sets a person's decision for a prompt of the brand, or (null) takes it
 * back to the rule's, logged with what it was; a change the log can't hold
 * is put back. A prompt outside the brand and its organization reads as not
 * found.
 */
export async function setDecision({ orgId, brandId, promptId, decision, userId }) {
  const prompt = supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id))')
    .eq('id', promptId)
    .eq('prompt_sets.brand_id', brandId);
  const found = await prompt.eq('prompt_sets.brands.organization_id', orgId).maybeSingle();
  if (!must(found, 'prompt')) throw new NotFound('Prompt not found');
  const overrides = () => supabaseAdmin.from('ads_decision_overrides');
  const write = (row) =>
    row
      ? overrides().upsert({ prompt_id: promptId, brand_id: brandId, ...row })
      : overrides().delete().eq('prompt_id', promptId).eq('brand_id', brandId);
  const own = overrides().select('decision, set_by, set_at').eq('prompt_id', promptId);
  const was = must(await own.eq('brand_id', brandId).maybeSingle(), 'decision');
  const now = decision && { decision, set_by: userId, set_at: new Date().toISOString() };
  must(await write(now), 'decision write');
  try {
    await logAdsActivity({
      orgId,
      brandId,
      actor: { userId },
      event: decision ? 'decision.set' : 'decision.cleared',
      target: { promptId },
      before: { decision: was?.decision ?? null },
      after: { decision },
    });
  } catch (err) {
    await putBack(write, was, 'decision');
    throw err;
  }
  return now ? { decision, setBy: userId, setAt: now.set_at } : null;
}

/**
 * Whether the prompt is one of the organization's demo brand's (00380),
 * whose decisions are the rule's: the decision route refuses it as the
 * middleware does, whichever brand the request names. A prompt outside the
 * organization isn't one here, and setDecision reads it as not found.
 */
export async function isDemoPrompt(orgId, promptId) {
  const prompt = supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id, is_demo))')
    .eq('id', promptId);
  const found = must(
    await prompt.eq('prompt_sets.brands.organization_id', orgId).maybeSingle(),
    'prompt',
  );
  return found?.prompt_sets?.brands?.is_demo === true;
}

/**
 * The week's snapshot of each prompt's rule decision, by the week's first
 * read (a prompt new this week, by its first), never again that week. A
 * failed write is logged, and the read still answers.
 */
export async function snapshotWeek(brandId, rows, now) {
  if (rows.length === 0) return;
  const week = isoWeek(now);
  const { error } = await supabaseAdmin.from('ads_opportunity_snapshots').upsert(
    rows.map((r) => ({
      brand_id: brandId,
      prompt_id: r.promptId,
      iso_week: week,
      decision: r.decision,
      reasons: r.reasons,
      inputs: { ...r.standing, period: SNAPSHOT_PERIOD },
    })),
    { onConflict: 'prompt_id,iso_week', ignoreDuplicates: true },
  );
  if (error) logger.warn({ brandId, week, err: error.message }, '[ads] weekly snapshot failed');
}

/**
 * The brand's opportunities for the period: every buying-intent prompt's
 * row, a person's decision over the rule's (`recommended` keeps the rule's),
 * the most searched first. Starter and the trial get the first OPEN_ROWS and
 * how many more are `locked`, decided here, not in the browser.
 */
export async function readOpportunities({ brand, orgId, period, now = new Date() }) {
  const settings = await readAdsSettings(orgId);
  const { rows, notAnalysed } = await readStanding({
    brandId: brand.id,
    orgId,
    period,
    thresholds: settings.thresholds,
    now,
  });
  const set = supabaseAdmin
    .from('ads_decision_overrides')
    .select('prompt_id, decision, set_by, set_at');
  const overrides = new Map(
    (must(await set.eq('brand_id', brand.id), 'decisions') ?? []).map((o) => [o.prompt_id, o]),
  );
  if (period === SNAPSHOT_PERIOD && !brand.is_demo) await snapshotWeek(brand.id, rows, now);

  const all = rows
    .map(({ standing, ...row }) => {
      const own = overrides.get(row.promptId);
      return {
        ...row,
        ...standing,
        // Where ads can show beside the prompt's answers, whatever the decision.
        adChannels: channelsFor(standing.engines).channels,
        recommended: row.decision,
        decision: own?.decision ?? row.decision,
        override: own ? { decision: own.decision, setBy: own.set_by, setAt: own.set_at } : null,
      };
    })
    .sort(
      (a, b) =>
        (b.volume ?? -1) - (a.volume ?? -1) ||
        a.text.localeCompare(b.text) ||
        a.promptId.localeCompare(b.promptId),
    );
  const open = (await readsEveryOpportunity(orgId, brand)) ? all : all.slice(0, OPEN_ROWS);
  return {
    period,
    week: isoWeek(now),
    rows: open,
    total: all.length,
    locked: all.length - open.length,
    notAnalysed,
    thresholds: adsThresholds(settings.thresholds),
  };
}
