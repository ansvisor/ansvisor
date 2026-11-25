import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { brandOutsiders, brandReaders } from '../access.js';
import { addressesByLanguage } from '../i18n.js';
import { dispatchBrandWebhook } from '../webhook-dispatch.js';
import { computePulseMetrics } from './metrics.js';
import { renderPulseEmail, sendPulseEmail } from './email.js';
import { skipsAsNotNotable } from './send-rules.js';
import {
  brandChoices,
  chose,
  emailsOf,
  sameAddress,
  uniqueAddresses,
  withoutSavers,
} from './audience.js';
import { deliverToSlack } from '../slack/deliver.js';
import { pulseMessage } from '../slack/blocks/pulse.js';

/**
 * Daily Pulse orchestration (#540).
 *
 * generatePulseForBrand runs after a brand's daily tracking job finishes.
 * It decides eligibility, computes the digest, records it in sent_pulses
 * (which doubles as the "already sent today" dedup and the 7-day warning
 * cooldown log), then delivers: email via Resend on cloud, the
 * `daily_pulse.created` webhook event everywhere, and the brand's Slack
 * channel where it picked one (#2139, lib/slack/deliver.js).
 *
 * Everything is best-effort — a pulse failure must never fail the
 * tracking job that triggered it.
 */

const WEEKLY_SEND_UTC_DAY = 1; // Monday

let warnedAppUrlPath = false;

export function appUrl() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    const url = new URL(raw);
    if (url.pathname !== '/' && url.pathname !== '' && !warnedAppUrlPath) {
      warnedAppUrlPath = true;
      logger.warn(
        { PUBLIC_APP_URL: raw },
        '[pulse] PUBLIC_APP_URL includes a path; using the origin only. Set it to the bare origin (e.g. https://app.example.com) to silence this warning.',
      );
    }
    return url.origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

/**
 * Recipient emails (brand access, spec §5.4): the explicit list from
 * settings, as an Admin or Manager set it, less the members who can't see
 * the brand, so a list made before someone was narrowed doesn't mail them
 * its numbers; an address that is no member's (a client, team@) stays.
 * Else every member who can see the brand: with All brands, every member.
 * The AI Traffic weekly digest (AT-013) sends to the same people.
 *
 * Since 00554 this is the brand's own audience: people outside the
 * workspace, and the teammates who haven't saved their own e-mail choices
 * (pulseRecipients leaves the others out and adds them by their choice).
 */
export async function resolveRecipients(organizationId, settings, brandId) {
  if (settings?.recipients?.length) {
    const outsiders = await brandOutsiders(organizationId, brandId);
    if (outsiders.length === 0) return settings.recipients;
    const hidden = new Set((await emailsOf(outsiders)).map(sameAddress));
    return settings.recipients.filter((address) => !hidden.has(sameAddress(address)));
  }

  const readers = await brandReaders(organizationId, [brandId]);
  return emailsOf([...readers.keys()]);
}

// In webhook mode the tracking job can "complete" while Cloro is still
// delivering results (the worker's drain loop gives up after 10 minutes
// without progress, but Cloro's real latency is 30-80 minutes) — a pulse
// computed at that moment emails partial-window numbers that contradict the
// dashboard. Wait for the brand's pending-task queue to drain first; the
// cap only exists so an orphaned task row can't block the pulse forever
// (cleanupStalePendingTasks sweeps those after 2h).
const DRAIN_POLL_MS = 60_000;
const DRAIN_MAX_WAIT_MS = 90 * 60_000;
// Tasks older than this are ghosts: Cloro accepted them and never called back
// (google-aio does this routinely when a query has no AI Overview). Waiting on
// them is pure cost — they are already past any plausible delivery latency and
// cleanupStalePendingTasks removes them on the next cycle. Counting them kept
// every brand parked for the full 90-minute cap, which also synchronised the
// wake-ups: whole waves of brands started computing metrics in the same second
// and the heaviest one hit the database statement timeout and lost its pulse.
const GHOST_TASK_AGE_MS = 45 * 60_000;

async function waitForCloroDrain(brandId) {
  const deadline = Date.now() + DRAIN_MAX_WAIT_MS;
  for (;;) {
    const freshSince = new Date(Date.now() - GHOST_TASK_AGE_MS).toISOString();
    const { count, error } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('task_id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('submitted_at', freshSince);
    // A failed read must not be mistaken for "nothing pending" — retry on the
    // next tick rather than computing the pulse on a half-delivered window.
    if (error) {
      logger.warn({ err: error, brandId }, 'pulse drain poll failed, retrying');
    } else if (!count) {
      return true;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        { brandId, pending: count },
        'pulse proceeding although cloro tasks are still pending',
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
  }
}

/**
 * The dedupe key for a computed digest: the end of the window it describes
 * (#701).
 *
 * `pulse_date` alone cannot express "these two mails say the same thing".
 * The daily KPI window is anchored to the tracking-run ledger, so two pulses
 * fired on different calendar days repeat each other verbatim whenever the
 * anchor has not moved between them — which is exactly what happened when the
 * catch-up sweep recovered a missed day at the start of a cycle and the
 * brand's own run pulsed an hour later, and again on every following day for a
 * brand whose runs had stopped stamping.
 *
 * Returns null for windows that are not run-anchored (weekly digests, and
 * brands with no completed run yet). Their `to` is the wall clock, which is
 * different on every call and would make this check a no-op anyway — better to
 * say so than to compare values that can never match.
 */
export function pulseWindowKey(metrics) {
  const window = metrics?.window;
  if (!window?.runAnchored) return null;
  return window.to ?? null;
}

/** Warning keys already sent for this brand in the last 7 days. */
async function recentWarningKeys(brandId, now) {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from('sent_pulses')
    .select('warning_keys')
    .eq('brand_id', brandId)
    .gte('created_at', since);
  const keys = new Set();
  for (const row of data ?? []) {
    for (const key of row.warning_keys ?? []) keys.add(key);
  }
  return keys;
}

/** Whether a pulse at `frequency` goes out today. */
function isDue(frequency, now) {
  if (frequency === 'daily' || frequency === 'notable') return true;
  return frequency === 'weekly' && now.getUTCDay() === WEEKLY_SEND_UTC_DAY;
}

/** The order a day's frequencies are worked in: the brand's own first. */
const FREQUENCY_ORDER = ['daily', 'notable', 'weekly'];

/**
 * Who is mailed a brand's pulse at `frequency` (00554): the brand's own
 * audience when it is the brand's frequency (resolveRecipients, less the
 * people who saved their own choices), and the people who chose it.
 */
export async function pulseRecipients({ organizationId, brandId, settings, choices, frequency }) {
  const brandFrequency = settings?.frequency ?? 'notable';
  const addresses = [];
  if (frequency === brandFrequency) {
    const list = await resolveRecipients(organizationId, settings, brandId);
    addresses.push(...(await withoutSavers(list, choices.savers)));
  }
  addresses.push(...(await emailsOf(chose(choices.people, frequency))));
  return uniqueAddresses(addresses);
}

export async function generatePulseForBrand(brandId, { pulseDate: pulseDateOverride } = {}) {
  try {
    const now = new Date();
    // The catch-up sweep passes the missed run's completion date so a
    // recovered pulse claims THAT day's dedupe slot — today's real pulse
    // (fired when today's run completes) keeps its own date.
    const pulseDate = pulseDateOverride ?? now.toISOString().slice(0, 10);

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id, name, organization_id, is_active, is_demo')
      .eq('id', brandId)
      .single();
    if (!brand?.is_active) return { skipped: 'brand_inactive' };
    // A demo brand (00380) is sample data: nobody is mailed about it.
    if (brand.is_demo) return { skipped: 'demo_brand' };

    // Hard requirement: never generate for orgs without an active or
    // trialing subscription (self-host always passes — isSubscriptionActive
    // short-circuits when not cloud).
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('subscription_status')
      .eq('id', brand.organization_id)
      .single();
    if (!isSubscriptionActive(org?.subscription_status)) {
      return { skipped: 'subscription_inactive' };
    }

    const { data: settings } = await supabaseAdmin
      .from('pulse_settings')
      .select('frequency, recipients')
      .eq('brand_id', brandId)
      .maybeSingle();
    // The brand's own frequency: its outside recipients, the teammates who
    // haven't saved their own choices, its webhook and its Slack channel.
    const frequency = settings?.frequency ?? 'notable';

    // People's own choices (00554), e-mailed on the cloud only. Each
    // frequency due today is its own pulse: a weekly one on Mondays reads
    // the last 7 days, daily and notable ones the latest run.
    const choices = isCloud()
      ? await brandChoices(brand.organization_id, brand.id, 'daily_pulse')
      : { savers: new Set(), people: new Map() };
    const due = new Set();
    if (frequency !== 'off' && isDue(frequency, now)) due.add(frequency);
    for (const choice of choices.people.values()) {
      if (choice !== 'off' && isDue(choice, now)) due.add(choice);
    }
    if (due.size === 0) return { skipped: frequency === 'off' ? 'off' : 'not_weekly_day' };

    // Dedup: at most one pulse per brand per day.
    const { data: existing } = await supabaseAdmin
      .from('sent_pulses')
      .select('id')
      .eq('brand_id', brandId)
      .eq('pulse_date', pulseDate)
      .maybeSingle();
    if (existing) return { skipped: 'already_sent' };

    // Don't compute until this brand's Cloro results have actually landed —
    // the numbers must match what the dashboard will show for the same
    // window (see waitForCloroDrain).
    await waitForCloroDrain(brandId);

    const dayMetrics =
      due.has('daily') || due.has('notable')
        ? await computePulseMetrics(brandId, { windowDays: 1, now: new Date() })
        : null;
    const weekMetrics = due.has('weekly')
      ? await computePulseMetrics(brandId, { windowDays: 7, now: new Date() })
      : null;
    const metricsFor = (f) => (f === 'weekly' ? weekMetrics : dayMetrics);

    // Skip windows with no fresh tracking results.
    for (const f of [...due]) if (metricsFor(f).kpis.totalResults === 0) due.delete(f);
    if (due.size === 0) return { skipped: 'no_fresh_results' };

    // Never mail the same window twice, whichever path fired (#701). The
    // pulse_date slot claimed above cannot see this: a recovery pulse dated to
    // the missed day and today's own pulse hold different dates while
    // describing the identical tracking run.
    const windowKey = dayMetrics && pulseWindowKey(dayMetrics);
    if (windowKey && (due.has('daily') || due.has('notable'))) {
      const { data: samePulse, error: sameErr } = await supabaseAdmin
        .from('sent_pulses')
        .select('id, pulse_date')
        .eq('brand_id', brandId)
        .eq('payload->window->>to', windowKey)
        .limit(1)
        .maybeSingle();
      // A failed read must not suppress a pulse — the insert below still has
      // the unique index as the final guard.
      if (sameErr) {
        logger.warn({ err: sameErr, brandId, windowKey }, 'pulse window lookup failed');
      } else if (samePulse) {
        logger.info(
          { brandId, windowKey, alreadySentFor: samePulse.pulse_date },
          'skipping daily pulse — this window was already sent',
        );
        due.delete('daily');
        due.delete('notable');
        if (due.size === 0) return { skipped: 'window_already_sent' };
      }
    }

    // Warning cooldown: don't repeat the same warning for the same subject
    // within 7 days.
    const cooldown = await recentWarningKeys(brandId, now);
    for (const metrics of [dayMetrics, weekMetrics]) {
      if (metrics) metrics.warnings = metrics.warnings.filter((w) => !cooldown.has(w.key));
    }

    // "Only when notable" still sends a brand's first pulse. A failed read
    // counts as "not first", so a hiccup can't turn into an extra mail.
    if (due.has('notable')) {
      const { count, error: countError } = await supabaseAdmin
        .from('sent_pulses')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId);
      const isFirstPulse = !countError && count === 0;
      if (skipsAsNotNotable({ frequency: 'notable', isFirstPulse, metrics: dayMetrics })) {
        due.delete('notable');
      }
    }
    if (due.size === 0) return { skipped: 'nothing_notable' };

    // The brand's own pulse (webhook, Slack, the row's frequency) when it is
    // due; else the first of the people's.
    const brandDue = due.has(frequency);
    const primary = brandDue ? frequency : FREQUENCY_ORDER.find((f) => due.has(f));
    const metrics = metricsFor(primary);
    const sendOrder = [primary, ...FREQUENCY_ORDER.filter((f) => f !== primary && due.has(f))];

    // Read before the claim: a read that fails (a brief 503) then leaves no
    // claim, and the catch-up sweep sends the pulse later, webhook included.
    const sends = [];
    if (isCloud()) {
      for (const f of sendOrder) {
        const to = await pulseRecipients({
          organizationId: brand.organization_id,
          brandId: brand.id,
          settings,
          choices,
          frequency: f,
        });
        if (to.length) sends.push({ frequency: f, metrics: metricsFor(f), to });
      }
    }

    // Record first — the unique (brand_id, pulse_date) constraint makes
    // this the race-safe claim on "today's pulse".
    const warningKeys = new Set(sendOrder.flatMap((f) => metricsFor(f).warnings.map((w) => w.key)));
    const { data: pulseRow, error: insertError } = await supabaseAdmin
      .from('sent_pulses')
      .insert({
        brand_id: brandId,
        pulse_date: pulseDate,
        frequency: primary,
        payload: metrics,
        warning_keys: [...warningKeys],
      })
      .select('id')
      .single();
    if (insertError) {
      // 23505 = another worker claimed this pulse between our checks and the
      // insert — either today's date slot or, via the window index, the same
      // tracking window under a different date.
      if (insertError.code === '23505') return { skipped: 'already_sent' };
      throw new Error(insertError.message);
    }

    const insightsUrl = `${appUrl()}/dashboard/insights`;
    const settingsUrl = `${appUrl()}/dashboard/settings?tab=notifications`;

    // Email leg — cloud only.
    let emailSent = false;
    let recipientCount = 0;
    for (const send of sends) {
      // Each in their own language (LOC-008): one send per language. The
      // count is of those whose send was accepted.
      const groups = await addressesByLanguage(brand.organization_id, send.to);
      for (const [locale, to] of groups) {
        const { subject, html } = renderPulseEmail({
          brandName: brand.name,
          metrics: send.metrics,
          insightsUrl,
          settingsUrl,
          locale,
        });
        if (await sendPulseEmail({ to, subject, html, settingsUrl })) {
          emailSent = true;
          recipientCount += to.length;
        }
      }
    }

    // Webhook leg — cloud and self-host alike, at the brand's own frequency.
    const { sent } = brandDue
      ? await dispatchBrandWebhook(brandId, {
          event: 'daily_pulse.created',
          brand: { id: brand.id, name: brand.name },
          pulse: {
            date: pulseDate,
            frequency,
            kpis: metrics.kpis,
            highlights: metrics.highlights,
            warnings: metrics.warnings,
            degraded_platforms: metrics.degradedPlatforms,
            insights_url: insightsUrl,
          },
        })
      : { sent: 0 };

    await supabaseAdmin
      .from('sent_pulses')
      .update({
        email_sent: emailSent,
        email_recipient_count: emailSent ? recipientCount : 0,
        webhook_sent: sent > 0,
      })
      .eq('id', pulseRow.id);

    // Slack leg — cloud and self-host alike (#2139): the brand's channel, when
    // it picked one and has the Pulse on there, at the brand's own frequency.
    // Never throws; recorded apart from the legs above, so a database without
    // 00515 still records them.
    const slack = brandDue
      ? await deliverToSlack({
          brand,
          kind: 'pulse',
          dedupeKey: `pulse:${pulseDate}`,
          message: () => pulseMessage({ brandName: brand.name, metrics, insightsUrl, settingsUrl }),
        })
      : { status: 'skipped', reason: 'brand_pulse_not_due' };
    const slackSent = slack.status === 'sent';
    if (slackSent) {
      const { error: slackError } = await supabaseAdmin
        .from('sent_pulses')
        .update({ slack_sent: true })
        .eq('id', pulseRow.id);
      if (slackError) {
        logger.warn({ brandId, code: slackError.code ?? null }, 'pulse slack_sent not recorded');
      }
    }

    logger.info(
      {
        brandId,
        pulseDate,
        frequency,
        sent: sends.map((send) => send.frequency),
        emailSent,
        recipientCount,
        webhooksSent: sent,
        slack: slack.status === 'skipped' ? `skipped:${slack.reason}` : slack.status,
      },
      'daily pulse generated',
    );
    return { generated: true, emailSent, webhooksSent: sent, slackSent };
  } catch (err) {
    logger.error({ err, brandId }, 'daily pulse generation failed');
    return { error: true };
  }
}

/**
 * Catch-up sweep (#missed-pulse incident): the per-brand pulse trigger is
 * fire-and-forget at the end of a tracking job — a process death, deploy, or
 * OOM in that window silently eats the mail while the run's stamp survives.
 * This sweep runs at the start of the daily cycle: any brand whose latest
 * completed run (last 36h) has no pulse row created after it gets a recovery
 * pulse, dated to that run's completion day so today's real pulse keeps its
 * own dedupe slot.
 *
 * Two guards keep that from turning into a duplicate mail: the sent_pulses
 * (brand_id, pulse_date) key stops the same day being sent twice, and the
 * window key (#701) stops the recovery pulse repeating a run that today's own
 * pulse is about to report — the two dates disagree, the data does not.
 *
 * Cron runs only: the pulse trigger never fires for manual/immediate runs, so
 * those are not "missed" pulses to recover. Sweeping them mailed every new
 * brand twice on its first morning — once at cycle start for yesterday's
 * onboarding run, once when its own daily run completed an hour later.
 */
export async function runPulseCatchUp() {
  try {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const { data: runs, error } = await supabaseAdmin
      .from('tracking_runs')
      .select('brand_id, completed_at')
      .eq('source', 'cron')
      .not('completed_at', 'is', null)
      .gte('completed_at', since)
      .order('completed_at', { ascending: false });
    if (error) throw new Error(error.message);

    const latestByBrand = new Map();
    for (const r of runs || []) {
      if (!latestByBrand.has(r.brand_id)) latestByBrand.set(r.brand_id, r.completed_at);
    }

    let sent = 0;
    let skipped = 0;
    for (const [brandId, completedAt] of latestByBrand) {
      const { count, error: countErr } = await supabaseAdmin
        .from('sent_pulses')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('created_at', completedAt);
      if (countErr || (count ?? 0) > 0) continue; // run already pulsed (or unknowable)

      const result = await generatePulseForBrand(brandId, {
        pulseDate: completedAt.slice(0, 10),
      });
      if (result?.generated) {
        logger.info({ brandId, runCompletedAt: completedAt }, '[pulse] catch-up pulse sent');
        sent++;
      } else {
        skipped++;
      }
    }

    if (sent > 0 || skipped > 0) {
      logger.info({ sent, skipped }, '[pulse] catch-up sweep completed');
    }
    return { sent, skipped };
  } catch (err) {
    logger.error({ err }, '[pulse] catch-up sweep failed');
    return { error: true };
  }
}
