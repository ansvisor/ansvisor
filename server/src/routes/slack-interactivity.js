import { Router } from 'express';
import { logger } from '../lib/logger.js';
import { ACTION_IDS, handleSlackDecision } from '../lib/slack/approvals.js';
import { checkSlackSignature, slackSigningSecret } from '../lib/slack/signature.js';
import { webhookCallbackAuthFailureLimiter } from '../middleware/rate-limiter.js';

/**
 * POST /webhooks/slack/interactivity: the Slack app's Interactivity Request
 * URL (#2139, N7), where Slack sends the clicks on an "agent needs you"
 * message's Approve and Reject. Public by design, so every request is
 * checked first (lib/slack/signature.js): its signature over the raw body
 * (server.js keeps this path's body as bytes) and its timestamp; a bad one,
 * or no SLACK_SIGNING_SECRET on this server, is 401 and nothing happens.
 * Failed checks count in the small per-IP bucket the other webhooks use.
 *
 * Slack wants its answer within 3 seconds: a verified click is answered 200
 * at once, then handled (lib/slack/approvals.js), whose answer goes back
 * through the click's response_url. Slack sending a request again
 * (X-Slack-Retry-Num) is answered 200 and dropped: the first is handled, and
 * a decision is taken once anyway. Other interactions (Open in Ansvisor's
 * link, anything else) are answered 200 and ignored.
 */

let warnedNoSecret = false;

/** Slack's form body: its `payload` field's JSON, or null. */
function payloadOf(raw) {
  try {
    const value = new URLSearchParams(raw.toString('utf8')).get('payload');
    const payload = value ? JSON.parse(value) : null;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export function createSlackInteractivityRouter({
  handle = handleSlackDecision,
  now = Date.now,
} = {}) {
  const router = Router();
  router.use(webhookCallbackAuthFailureLimiter);

  router.post('/interactivity', (req, res) => {
    const secret = slackSigningSecret();
    const verdict = checkSlackSignature({
      secret,
      timestamp: req.get('X-Slack-Request-Timestamp'),
      signature: req.get('X-Slack-Signature'),
      rawBody: req.body,
      now: now(),
    });
    if (verdict !== 'ok') {
      if (verdict === 'no_secret' && !warnedNoSecret) {
        warnedNoSecret = true;
        logger.warn('[slack] SLACK_SIGNING_SECRET is not set: every Slack click is refused');
      }
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (req.get('X-Slack-Retry-Num')) return res.status(200).end();
    const payload = payloadOf(req.body);
    if (!payload) return res.status(400).json({ error: 'invalid' });
    res.status(200).end();
    const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
    if (payload.type !== 'block_actions' || !ACTION_IDS.has(action?.action_id)) return undefined;
    // After the answer: Slack has its 200, the decision takes what it takes.
    void Promise.resolve(handle(payload)).catch((err) =>
      logger.error({ err: { name: err?.name } }, '[slack] click not handled'),
    );
    return undefined;
  });
  return router;
}

export default createSlackInteractivityRouter();
