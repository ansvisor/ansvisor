import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { dispatchBrandWebhook } from '../webhook-dispatch.js';
import { computePulseMetrics } from './metrics.js';
import { renderPulseEmail, sendPulseEmail } from './email.js';

/**
 * Daily Pulse orchestration (#540).
 *
 * generatePulseForBrand runs after a brand's daily tracking job finishes.
 * It decides eligibility, computes the digest, records it in sent_pulses
 * (which doubles as the "already sent today" dedup and the 7-day warning
 * cooldown log), then delivers: email via Resend on cloud, and the
 * `daily_pulse.created` webhook event everywhere.
 *
 * Everything is best-effort — a pulse failure must never fail the
 * tracking job that triggered it.
 */

const WEEKLY_SEND_UTC_DAY = 1; // Monday

let warnedAppUrlPath = false;

function appUrl() {
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

/** Recipient emails: explicit list from settings, else every org member. */
async function resolveRecipients(organizationId, settings) {
  if (settings?.recipients?.length) return settings.recipients;

  const { data: members } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', organizationId);

  const emails = [];
  for (const member of members ?? []) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(member.id);
    if (authUser?.user?.email) emails.push(authUser.user.email);
  }
  return emails;
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

async function waitForCloroDrain(brandId) {
  const deadline = Date.now() + DRAIN_MAX_WAIT_MS;
  for (;;) {
    const { count } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('task_id', { count: 'exact', head: true })
      .eq('brand_id', brandId);
    if (!count) return true;
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

export async function generatePulseForBrand(brandId) {
  try {
    const now = new Date();
    const pulseDate = now.toISOString().slice(0, 10);

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id, name, organization_id, is_active')
      .eq('id', brandId)
      .single();
    if (!brand?.is_active) return { skipped: 'brand_inactive' };

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
    const frequency = settings?.frequency ?? 'daily';

    if (frequency === 'off') return { skipped: 'off' };
    if (frequency === 'weekly' && now.getUTCDay() !== WEEKLY_SEND_UTC_DAY) {
      return { skipped: 'not_weekly_day' };
    }

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

    const windowDays = frequency === 'weekly' ? 7 : 1;
    const metrics = await computePulseMetrics(brandId, { windowDays, now: new Date() });

    // Skip brands with no fresh tracking results in the window.
    if (metrics.kpis.totalResults === 0) return { skipped: 'no_fresh_results' };

    // Warning cooldown: don't repeat the same warning for the same subject
    // within 7 days.
    const cooldown = await recentWarningKeys(brandId, now);
    metrics.warnings = metrics.warnings.filter((w) => !cooldown.has(w.key));

    if (frequency === 'notable' && !metrics.highlights.length && !metrics.warnings.length) {
      return { skipped: 'nothing_notable' };
    }

    // Record first — the unique (brand_id, pulse_date) constraint makes
    // this the race-safe claim on "today's pulse".
    const { data: pulseRow, error: insertError } = await supabaseAdmin
      .from('sent_pulses')
      .insert({
        brand_id: brandId,
        pulse_date: pulseDate,
        frequency,
        payload: metrics,
        warning_keys: metrics.warnings.map((w) => w.key),
      })
      .select('id')
      .single();
    if (insertError) {
      // 23505 = another worker claimed today's pulse between our check and
      // this insert.
      if (insertError.code === '23505') return { skipped: 'already_sent' };
      throw new Error(insertError.message);
    }

    const insightsUrl = `${appUrl()}/dashboard/insights`;
    const settingsUrl = `${appUrl()}/dashboard/settings?tab=notifications`;

    // Email leg — cloud only.
    let emailSent = false;
    let recipientCount = 0;
    if (isCloud()) {
      const recipients = await resolveRecipients(brand.organization_id, settings);
      recipientCount = recipients.length;
      if (recipients.length) {
        const { subject, html } = renderPulseEmail({
          brandName: brand.name,
          metrics,
          insightsUrl,
          settingsUrl,
        });
        emailSent = await sendPulseEmail({ to: recipients, subject, html, settingsUrl });
      }
    }

    // Webhook leg — cloud and self-host alike.
    const { sent } = await dispatchBrandWebhook(brandId, {
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
    });

    await supabaseAdmin
      .from('sent_pulses')
      .update({
        email_sent: emailSent,
        email_recipient_count: emailSent ? recipientCount : 0,
        webhook_sent: sent > 0,
      })
      .eq('id', pulseRow.id);

    logger.info(
      { brandId, pulseDate, frequency, emailSent, recipientCount, webhooksSent: sent },
      'daily pulse generated',
    );
    return { generated: true, emailSent, webhooksSent: sent };
  } catch (err) {
    logger.error({ err, brandId }, 'daily pulse generation failed');
    return { error: true };
  }
}
