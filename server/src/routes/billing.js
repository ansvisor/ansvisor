/**
 * Billing answers that go to the team (the plan itself is changed by the web
 * app, through Stripe).
 *
 * POST /api/billing/cancel-feedback — { reasons, message, choice } → kept and
 *                                     e-mailed to CANCEL_FEEDBACK_EMAILS, with
 *                                     replies going to the customer
 */

import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import { deliverEmail } from '../lib/email.js';
import {
  DAILY_LIMIT,
  SUBSCRIBED_STATUSES,
  buildCancelFeedbackEmail,
  canWait,
  cancelFeedbackSchema,
  feedbackRecipients,
} from '../lib/cancel-feedback.js';

const router = Router();

router.post('/cancel-feedback', async (req, res) => {
  try {
    const parsed = cancelFeedbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const feedback = parsed.data;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id, role, full_name')
      .eq('id', req.user.id)
      .single();
    const orgId = profile?.organization_id;
    if (!orgId) return res.status(403).json({ error: 'No organization' });
    // Cancelling is the admins', as the web's DELETE is: no one else can
    // tell the team the plan was cancelled, or ask for three days.
    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can cancel the plan', code: 'admin_only' });
    }

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, plan, subscription_status, subscription_ends_at, stripe_subscription_id')
      .eq('id', orgId)
      .single();
    // The browser's checks, again here: a direct request can't report a
    // plan that isn't there, or promise an answer after it renews.
    if (!org?.stripe_subscription_id || !SUBSCRIBED_STATUSES.includes(org.subscription_status)) {
      return res.status(400).json({ error: 'No subscription to cancel', code: 'no_subscription' });
    }
    // Only a period end the DB knows, still ahead and too close, refuses
    // waiting. A missing or past one means the DB is behind Stripe (only a
    // subscription update writes it), and the dialog checked Stripe's date.
    const endsAt = org.subscription_ends_at ? new Date(org.subscription_ends_at) : null;
    if (feedback.choice === 'wait' && endsAt && endsAt > new Date() && !canWait(endsAt)) {
      return res
        .status(400)
        .json({ error: 'The plan renews before we could answer', code: 'too_late' });
    }

    const { count } = await supabaseAdmin
      .from('cancellation_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) >= DAILY_LIMIT) {
      return res
        .status(429)
        .json({ error: 'Too many messages today. Please write to support.', code: 'too_many' });
    }

    // Kept before the e-mail goes, so a failed send loses nothing.
    const { data: row, error } = await supabaseAdmin
      .from('cancellation_feedback')
      .insert({
        organization_id: orgId,
        created_by: req.user.id,
        reasons: feedback.reasons,
        message: feedback.message,
        choice: feedback.choice,
        plan: org?.plan ?? null,
        subscription_status: org?.subscription_status ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user: { name: profile.full_name, email: req.user.email, role: profile.role },
      feedback,
    });
    const emailStatus = await deliverEmail({
      to: feedbackRecipients(),
      subject,
      html,
      replyTo: req.user.email || undefined,
    });
    if (emailStatus !== 'sent') {
      req.log.warn({ emailStatus, feedbackId: row.id }, '[billing] cancel feedback not e-mailed');
    }
    await supabaseAdmin
      .from('cancellation_feedback')
      .update({ email_status: emailStatus })
      .eq('id', row.id);
    // A wait is a promise to answer: when the team surely wasn't told, say so
    // rather than "we're on it". A cancel is done anyway; 'unknown' may have
    // gone out.
    if (feedback.choice === 'wait' && (emailStatus === 'skipped' || emailStatus === 'refused')) {
      return res
        .status(503)
        .json({ error: "Your message didn't reach the team", code: 'not_sent' });
    }

    return res.status(201).json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, '[billing] cancel feedback failed');
    return res.status(500).json({ error: 'Could not send your message' });
  }
});

export default router;
