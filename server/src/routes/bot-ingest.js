/**
 * POST /bots/ingest — AI-bot requests from a brand's Cloudflare Worker
 * (AT-010, spec §6.1). Public, outside /api: the sender is the customer's
 * edge, authenticated by its connection secret (Authorization: Bearer).
 * Body: { requests: [{ userAgent, ip, url, status, at, country }] }.
 */

import express, { Router } from 'express';
import { PlanLimitError } from '../lib/plan-guard.js';
import { logger } from '../lib/logger.js';
import { botIngestLimiter } from '../middleware/rate-limiter.js';
import { connectionForSecret, ingestBotRequests } from '../lib/bot-ingest.js';

const router = Router();

router.post('/bots/ingest', botIngestLimiter, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const connection = await connectionForSecret(secret);
    if (!connection) return res.status(401).json({ error: 'unknown_connection' });
    const result = await ingestBotRequests(connection, req.body?.requests);
    return res.json(result);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({ error: 'plan_limit', message: error.message });
    }
    // Mounted before the request-id middleware: there is no req.log here.
    logger.error({ err: error }, 'bot ingest error');
    return res.status(500).json({ error: 'ingest_failed' });
  }
});

export default router;
