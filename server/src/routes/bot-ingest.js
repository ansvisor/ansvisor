/**
 * POST /bots/ingest — AI-bot requests from a brand's own edge (AT-010, spec
 * §6.1). Public, outside /api: the sender is the customer's Cloudflare or
 * Vercel, authenticated by its connection secret (Authorization: Bearer).
 * The body is read by the connection's kind (bot-log-formats.js): a Worker's
 * JSON batch, a Logpush file, or a Vercel drain's log entries. Log senders'
 * records count against the month's raw cap before they are read.
 */

import express, { Router } from 'express';
import { PlanLimitError } from '../lib/plan-guard.js';
import {
  MAX_BATCH,
  connectionForSecret,
  countRawRecords,
  ingestBotRequests,
} from '../lib/bot-ingest.js';
import { readSenderBody } from '../lib/bot-log-formats.js';

const router = Router();

// Raw: each kind has its own body, and a Logpush file comes gzipped. A body
// sent with Content-Encoding: gzip is inflated here, within the limit.
const body = express.raw({ type: () => true, limit: '20mb' });

router.post('/bots/ingest', body, async (req, res) => {
  try {
    const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const connection = await connectionForSecret(secret);
    if (!connection) return res.status(401).json({ error: 'unknown_connection' });

    let parsed;
    try {
      parsed = readSenderBody(connection.kind, req.body);
    } catch {
      return res.status(400).json({ error: 'unreadable_body' });
    }

    const worker = connection.kind === 'cloudflare_worker';
    if (!worker) {
      const raw = await countRawRecords(connection, parsed.records);
      if (!raw.allowed) {
        // Answered with 200 so the sender doesn't retry what won't be read.
        return res.json({
          received: parsed.records,
          verified: 0,
          stored: 0,
          ...(raw.locked ? { locked: true } : { rawCapped: true }),
        });
      }
    }

    const result = await ingestBotRequests(connection, parsed.requests, {
      limit: worker ? MAX_BATCH : Infinity,
    });
    return res.json({ ...result, records: parsed.records });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({ error: 'plan_limit', message: error.message });
    }
    req.log?.error({ err: error }, 'bot ingest error');
    return res.status(500).json({ error: 'ingest_failed' });
  }
});

export default router;
