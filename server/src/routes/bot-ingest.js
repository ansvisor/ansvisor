/**
 * POST /bots/ingest — AI-bot requests from a brand's own edge (AT-010, spec
 * §6.1). Public, outside /api: the sender is the customer's Cloudflare or
 * Vercel, authenticated by its connection secret (Authorization: Bearer)
 * before its body is read, so a caller without one can't make the server
 * take in 20 MB. The body is read by the connection's kind
 * (bot-log-formats.js): a Worker's JSON batch, a Logpush file, or a Vercel
 * drain's log entries. Log senders' records count against the month's raw
 * cap before they are read, and a file they send again (after timing out,
 * say) is read once.
 */

import express, { Router } from 'express';
import { PlanLimitError } from '../lib/plan-guard.js';
import {
  MAX_BATCH,
  claimLogFile,
  connectionForSecret,
  countRawRecords,
  ingestBotRequests,
  releaseLogFile,
} from '../lib/bot-ingest.js';
import { LogTooLargeError, readSenderBody } from '../lib/bot-log-formats.js';
import { logger } from '../lib/logger.js';
import { botIngestLimiter } from '../middleware/rate-limiter.js';
import { markBotSenderVerified } from '../middleware/verified-tokens.js';

const router = Router();

// Raw: each kind has its own body, and a Logpush file comes gzipped. A body
// sent with Content-Encoding: gzip is inflated here, within the limit.
// Mounted before the app's JSON parser (server.js), so this reads it.
const body = express.raw({ type: () => true, limit: '20mb' });

/** The live connection the secret names, before the body is read; 401 otherwise. */
async function sender(req, res, next) {
  try {
    const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const connection = await connectionForSecret(secret);
    if (!connection) return res.status(401).json({ error: 'unknown_connection' });
    // Its next requests count against the connection's bucket, not the IP's.
    markBotSenderVerified(req.headers.authorization, connection.id);
    res.locals.connection = connection;
    return next();
  } catch (error) {
    logger.error({ err: error }, 'bot ingest error');
    return res.status(500).json({ error: 'ingest_failed' });
  }
}

router.post('/bots/ingest', botIngestLimiter, sender, body, async (req, res) => {
  const { connection } = res.locals;
  // A log file's claim, given back unless the file was read.
  let claim = null;
  let read = false;
  try {
    const worker = connection.kind === 'cloudflare_worker';
    if (!worker) {
      claim = await claimLogFile(connection, req.body);
      // Answered with 200 so the sender stops sending what was read.
      if (!claim) return res.json({ received: 0, verified: 0, stored: 0, duplicate: true });
    }

    let parsed;
    try {
      parsed = await readSenderBody(connection.kind, req.body);
    } catch (err) {
      if (err instanceof LogTooLargeError) {
        logger.warn({ connectionId: connection.id, err }, '[ai-bots] log file too large');
        return res.status(413).json({ error: 'too_large', message: err.message });
      }
      return res.status(400).json({ error: 'unreadable_body' });
    }

    if (!worker) {
      const raw = await countRawRecords(connection, parsed.records);
      if (!raw.allowed) {
        // Answered with 200 so the sender doesn't retry what won't be read.
        read = true;
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
    read = true;
    return res.json({ ...result, records: parsed.records });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({ error: 'plan_limit', message: error.message });
    }
    // Mounted before the request-id middleware: there is no req.log here.
    logger.error({ err: error }, 'bot ingest error');
    return res.status(500).json({ error: 'ingest_failed' });
  } finally {
    if (claim && !read) await releaseLogFile(connection, claim);
  }
});

export default router;
