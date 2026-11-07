/**
 * A scheduled job's e-mails to addresses outside the workspace (W4-28, Chat
 * Wave 4 decision 16), as the Inbox card's buttons send them, behind
 * CHAT_AGENTIC. Only Admins and Managers; each Send is that person's click
 * (an EXECUTE), never a run's own (lib/chat-outbound-email.js).
 *
 * POST /api/chat-outbound/:id/send
 *   → 200 { success: true }: Resend took it; it is sent and logged.
 *   → 402 trial | plan, 403 forbidden, 404 not_found, 409 sent | cancelled
 *     | removed | busy, 410 expired, 429 daily_limit (50 a day), 502
 *     send_failed (pending again, with why in `message`).
 * POST /api/chat-outbound/:id/cancel
 *   → 200 { success: true }: it won't go; logged. 403, 404, 409, 410 as Send.
 */

import { Router } from 'express';
import { z } from 'zod';
import { MANAGER_ROLES, allowRole } from '../lib/access.js';
import { cancelOutsideEmail, sendOutsideEmail } from '../lib/chat-outbound-email.js';

const router = Router();

const ONLY_MANAGERS = 'Only Admins and Managers can e-mail people outside the workspace.';

const answer = (res, outcome) =>
  outcome.ok
    ? res.json({ success: true })
    : res.status(outcome.status).json({
        success: false,
        code: outcome.code,
        message: outcome.message ?? outcome.code,
      });

router.post('/:id/send', async (req, res) => {
  if (!z.guid().safeParse(req.params.id).success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  try {
    if (!(await allowRole(res, req.user.id, MANAGER_ROLES, ONLY_MANAGERS))) return undefined;
    return answer(res, await sendOutsideEmail({ userId: req.user.id, id: req.params.id }));
  } catch (err) {
    req.log.error({ err }, 'outside e-mail send failed');
    return res.status(500).json({ success: false, message: 'Could not send the e-mail' });
  }
});

router.post('/:id/cancel', async (req, res) => {
  if (!z.guid().safeParse(req.params.id).success) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }
  try {
    if (!(await allowRole(res, req.user.id, MANAGER_ROLES, ONLY_MANAGERS))) return undefined;
    return answer(res, await cancelOutsideEmail({ userId: req.user.id, id: req.params.id }));
  } catch (err) {
    req.log.error({ err }, 'outside e-mail cancel failed');
    return res.status(500).json({ success: false, message: 'Could not cancel the e-mail' });
  }
});

export default router;
