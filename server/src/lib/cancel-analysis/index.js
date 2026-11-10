import { deliverEmail } from '../email.js';
import { logger } from '../logger.js';
import { analyseCancel, analysisInput } from './ai.js';
import { summariseActivity } from './activity.js';
import { readFeatureUse } from './feature-use.js';
import { buildCancelAnalysisEmail } from './follow-up-email.js';
import { ROW_LIMIT, posthogConfigured, readPersonRows } from './posthog.js';

/**
 * The cancel analysis: when a customer cancels, or asks the team for three
 * days, the team's e-mail (routes/billing.js) is followed in its thread by
 * an analysis of that person's last 14 days, sent after the customer has
 * their answer:
 *
 *   posthog.js        their page views, product events and rage and dead
 *                     clicks, from PostHog's query API;
 *   activity.js       day by day, where they got stuck, the replays to watch;
 *   feature-use.js    what the workspace never used, from our own tables;
 *   ai.js             why they may have cancelled and what to fix, in Turkish;
 *   follow-up-email.js  the e-mail.
 *
 * Only with CANCEL_FEEDBACK_EMAILS and PostHog (POSTHOG_PERSONAL_API_KEY,
 * POSTHOG_PROJECT_ID) set. Never throws: whatever fails is logged and the
 * follow-up goes without it, or not at all.
 */

/** Whether a follow-up can be made: PostHog is set up. */
export const cancelAnalysisConfigured = (env = process.env) => posthogConfigured(env);

/**
 * The first e-mail's Message-ID, which the follow-up answers: unique to the
 * answer kept, on the sender's domain (RESEND_FROM_EMAIL).
 */
export function threadMessageId(feedbackId, from = process.env.RESEND_FROM_EMAIL) {
  const domain = /@([A-Za-z0-9.-]+)/.exec(String(from ?? ''))?.[1] || 'ansvisor.invalid';
  return `<cancel-feedback-${String(feedbackId).replace(/[^A-Za-z0-9-]/g, '')}@${domain}>`;
}

/**
 * Reads, analyses and sends the follow-up to `recipients`, as "Re:" the first
 * e-mail's subject, answering `messageId` (In-Reply-To, References). No
 * reply-to: a reply stays with the team. Says what became of it.
 *
 * @param {{ orgId: string, userId: string, plan?: { plan?: string | null, status?: string | null },
 *   feedback: { choice: string, reasons: string[], message: string }, subject: string,
 *   messageId?: string | null, recipients: string[] }} input
 * @param {{ posthog?: object, db?: object, ai?: object }} [options] passed to the readers
 * @returns {Promise<'sent' | 'refused' | 'unknown' | 'skipped' | 'failed'>}
 */
export async function sendCancelAnalysis(
  { orgId, userId, plan, feedback, subject, messageId, recipients },
  options = {},
) {
  try {
    if (!recipients?.length || !cancelAnalysisConfigured()) return 'skipped';
    const [rows, featureUse] = await Promise.all([
      readPersonRows(userId, options.posthog),
      readFeatureUse(orgId, options.db ? { db: options.db } : undefined),
    ]);
    const activity = rows?.ok
      ? summariseActivity(rows, { distinctId: userId, rowLimit: ROW_LIMIT })
      : { ok: false };
    const ai = await analyseCancel(
      analysisInput({ feedback, plan, activity, featureUse }),
      options.ai,
    );
    const email = buildCancelAnalysisEmail({ subject, activity, featureUse, ai });
    const status = await deliverEmail({
      to: recipients,
      subject: email.subject,
      html: email.html,
      ...(messageId ? { headers: { 'In-Reply-To': messageId, References: messageId } } : {}),
    });
    if (status !== 'sent') logger.warn({ status }, '[cancel-analysis] follow-up not e-mailed');
    return status;
  } catch (err) {
    logger.warn({ err: { name: err?.name } }, '[cancel-analysis] follow-up failed');
    return 'failed';
  }
}
