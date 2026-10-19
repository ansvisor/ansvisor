import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { appUrl, resolveRecipients } from '../pulse/engine.js';
import { untrackedGoogleQueries } from '../untracked-queries.js';
import { digestWeek, summarySentences, topChanges, visitChangePct } from './summary.js';
import { renderTrafficDigestEmail, sendTrafficDigestEmail } from './email.js';

/**
 * The AI Traffic weekly digest (AT-013, spec §3.8): every Monday, for the
 * week before, "the summary line and the top three changes" to the Daily
 * Pulse's recipients (00036), unless Settings › Notifications turned it off
 * for the brand (00187).
 *
 * A brand with no AI visits in either week gets nothing. A week is claimed in
 * ai_traffic_digests before anything is sent, so two sweeps can't mail it
 * twice. Cloud only, like the pulse's e-mail. Best effort: one brand's
 * failure is logged and the sweep moves on.
 */

const WEEKLY_SEND_UTC_DAY = 1; // Monday, as the weekly pulse

async function rpc(name, params) {
  const { data, error } = await supabaseAdmin.rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/** The last second of the week: the reads that take an inclusive end stop on its Sunday. */
const lastSecond = (end) => new Date(Date.parse(end) - 1000).toISOString();

/**
 * The numbers behind one brand's digest, read as the AI Traffic page reads
 * them for a 7-day range.
 */
export async function readDigestData(brandId, week) {
  const merged = (from, to) =>
    rpc('ai_traffic_merged', {
      p_brand_id: brandId,
      p_from: from,
      p_to: to,
      p_to_inclusive: false,
      p_analytics: true,
    });
  const [cur, prev] = await Promise.all([
    merged(week.start, week.end),
    merged(week.prevStart, week.start),
  ]);
  const data = { cur: cur ?? {}, prev: prev ?? {} };
  if ((Number(data.cur.visits) || 0) + (Number(data.prev.visits) || 0) === 0) return data;

  const until = lastSecond(week.end);
  const [totals, pages, broken, untracked] = await Promise.all([
    supabaseAdmin
      .rpc('ga_traffic_totals', {
        p_brand_id: brandId,
        p_since: week.firstDay,
        p_until: week.lastDay,
      })
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (error) throw new Error(`ga_traffic_totals: ${error.message}`);
        return row;
      }),
    rpc('ai_traffic_pages', {
      p_brand_id: brandId,
      p_from: week.start,
      p_to: until,
      p_tab: 'cited_not_clicked',
      p_limit: 0,
      p_offset: 0,
    }),
    rpc('ai_traffic_broken_links', {
      p_brand_id: brandId,
      p_from: week.start,
      p_to: until,
      p_limit: 1,
      p_offset: 0,
    }),
    untrackedGoogleQueries(brandId, {
      since: week.firstDay,
      until: week.lastDay,
      latest: true,
      limit: 0,
    }),
  ]);
  // Share and conversions only from a connected Analytics (§3.8b rule 5).
  const gaSessions = (Number(totals?.sessions) || 0) > 0 ? Number(totals.sessions) : null;
  const platformValue =
    gaSessions === null
      ? null
      : await rpc('ga_platform_value', {
          p_brand_id: brandId,
          p_since: week.firstDay,
          p_until: week.lastDay,
        });
  return {
    ...data,
    gaSessions,
    platformValue: platformValue ?? null,
    citedNotClicked: Number(pages?.counts?.cited_not_clicked) || 0,
    broken: broken ?? null,
    untrackedQueries: untracked?.count ?? 0,
  };
}

/** What the e-mail says, from the numbers. */
export function digestContent(data) {
  const visits = Number(data.cur.visits) || 0;
  const prevVisits = Number(data.prev.visits) || 0;
  return {
    visits,
    prevVisits,
    change: visitChangePct(visits, prevVisits),
    sentences: summarySentences({
      visits,
      prevVisits,
      platforms: data.cur.platforms ?? [],
      gaSessions: data.gaSessions ?? null,
      platformValue: data.platformValue ?? null,
      citedNotClicked: data.citedNotClicked ?? 0,
      untrackedQueries: data.untrackedQueries ?? 0,
    }),
    changes: topChanges(data),
  };
}

/**
 * One brand's digest for the week before `now`'s.
 *
 * @returns {Promise<object>} what happened: `{ sent, emailSent, recipients }` or `{ skipped }`
 */
export async function sendTrafficDigestForBrand(brandId, { now = new Date() } = {}) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, organization_id, is_active')
    .eq('id', brandId)
    .single();
  if (!brand?.is_active) return { skipped: 'brand_inactive' };

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status')
    .eq('id', brand.organization_id)
    .single();
  if (!isSubscriptionActive(org?.subscription_status)) return { skipped: 'subscription_inactive' };

  const { data: settings } = await supabaseAdmin
    .from('pulse_settings')
    .select('recipients, traffic_digest')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (settings?.traffic_digest === false) return { skipped: 'off' };

  const week = digestWeek(now);
  const { data: existing } = await supabaseAdmin
    .from('ai_traffic_digests')
    .select('id')
    .eq('brand_id', brandId)
    .eq('week_start', week.firstDay)
    .maybeSingle();
  if (existing) return { skipped: 'already_sent' };

  const data = await readDigestData(brandId, week);
  const content = digestContent(data);
  if (content.visits === 0 && content.prevVisits === 0) return { skipped: 'no_traffic' };

  // Claim the week first: the unique (brand_id, week_start) is the race-safe
  // guard against a second sweep.
  const { data: row, error: claimError } = await supabaseAdmin
    .from('ai_traffic_digests')
    .insert({ brand_id: brandId, week_start: week.firstDay, payload: { week, ...content } })
    .select('id')
    .single();
  if (claimError) {
    if (claimError.code === '23505') return { skipped: 'already_sent' };
    throw new Error(claimError.message);
  }

  const recipients = await resolveRecipients(brand.organization_id, settings);
  let emailSent = false;
  if (recipients.length) {
    const settingsUrl = `${appUrl()}/dashboard/settings?tab=notifications`;
    const { subject, html } = renderTrafficDigestEmail({
      brandName: brand.name,
      week,
      ...content,
      trafficUrl: `${appUrl()}/dashboard/traffic`,
      settingsUrl,
    });
    emailSent = await sendTrafficDigestEmail({ to: recipients, subject, html, settingsUrl });
  }
  await supabaseAdmin
    .from('ai_traffic_digests')
    .update({ email_sent: emailSent, email_recipient_count: emailSent ? recipients.length : 0 })
    .eq('id', row.id);

  logger.info(
    { brandId, week: week.firstDay, emailSent, recipients: recipients.length },
    '[traffic-digest] sent',
  );
  return { sent: true, emailSent, recipients: recipients.length };
}

/**
 * Monday's sweep: every active brand's digest for the week before. Called
 * from the daily cycle after the Analytics sync, so Sunday's numbers are in.
 */
export async function sendTrafficDigests({ now = new Date() } = {}) {
  if (!isCloud()) return { skipped: 'self_hosted' };
  if (now.getUTCDay() !== WEEKLY_SEND_UTC_DAY) return { skipped: 'not_monday' };

  const { data: brands, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('is_active', true);
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const { id } of brands ?? []) {
    try {
      const result = await sendTrafficDigestForBrand(id, { now });
      if (result.sent) sent += 1;
    } catch (err) {
      logger.error({ err, brandId: id }, '[traffic-digest] brand failed');
    }
  }
  logger.info({ sent, brands: (brands ?? []).length }, '[traffic-digest] weekly sweep done');
  return { sent };
}
