/**
 * Chat's scheduled jobs' e-mails (CHAT-12 items 19, 26; W3-04b), for the
 * web's scheduled-job worker. Server to server: CRON_SECRET auth, as the
 * other internal endpoints.
 *
 * POST /api/internal/chat/schedules/email
 *   { orgId, scheduleId, runId?, kind: result|failed|paused, reason?,
 *     attachment?: { filename, content (base64) } }
 *   → 200 { status, sent }: the job's e-mail to its creator and the
 *     workspace's people it names, checked as it is sent
 *     (lib/chat-schedule-email.js). A PDF over 5 MB isn't attached; its
 *     link carries it. A run's result goes once.
 */

import { Router } from 'express';
import { z } from 'zod';
import { sendScheduleEmail } from '../lib/chat-schedule-email.js';
import logger from '../lib/logger.js';
import { webhookSecretsMatch } from '../lib/webhook-secret.js';

const router = Router();

// The secret is compared in constant time (webhookSecretsMatch), as the rate limiter does.
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  const secret = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!webhookSecretsMatch(process.env.CRON_SECRET, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** base64 of a 5 MB file is about 6.7 million characters: a little room, no more. */
const ATTACHMENT_MAX_CHARS = 7_200_000;

const emailSchema = z.strictObject({
  orgId: z.guid(),
  scheduleId: z.guid(),
  runId: z.guid().nullish(),
  kind: z.enum(['result', 'failed', 'paused']),
  reason: z.string().trim().max(200).optional(),
  attachment: z
    .strictObject({
      filename: z
        .string()
        .trim()
        .min(5)
        .max(200)
        .regex(/^[^/\\\r\n]+\.pdf$/i),
      content: z
        .string()
        .max(ATTACHMENT_MAX_CHARS)
        .regex(/^[A-Za-z0-9+/=]+$/),
    })
    .nullish(),
});

router.post('/email', async (req, res) => {
  const parsed = emailSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  try {
    const outcome = await sendScheduleEmail(parsed.data);
    return res.json({ success: true, ...outcome });
  } catch (err) {
    logger.error({ err, orgId: parsed.data.orgId }, 'scheduled job e-mail failed');
    return res.status(500).json({ success: false, message: 'Could not send the e-mail' });
  }
});

export default router;
