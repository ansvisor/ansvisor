/**
 * The AI bot report's connections (AT-010): each way a brand sends AI-bot
 * requests — a Cloudflare Worker, a Logpush job, a Vercel drain, a Fastly
 * HTTPS log stream or any log shipper through the generic webhook (#2170) —
 * with its own secret, shown
 * once. Admins and managers make and revoke them, and upload access logs, on
 * plans with the bot report (Starter has it locked, spec §7).
 *
 * GET    /api/bots/connections/:brandId           — the brand's connections and this month's use:
 *                                                   rows against the event cap, log records
 *                                                   against the raw cap
 * POST   /api/bots/connections/:brandId           — { kind } → a connection, its secret, the endpoint and
 *                                                   what to copy: the Worker, Logpush job, Vercel drain or Fastly format
 * DELETE /api/bots/connections/:brandId/:id       — revoke one
 * POST   /api/bots/upload/:brandId                — an access log file (#2170), read once, as a log
 *                                                   sender's file: { received, verified, stored, records },
 *                                                   or duplicate / rawCapped
 */

import express, { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { PlanLimitError, getBotCaps, getBotEventCap } from '../lib/plan-guard.js';
import {
  CONNECTION_KINDS,
  UPLOAD_KIND,
  hashSecret,
  ingestLogFile,
  logFileHash,
  logFileRead,
  newConnectionSecret,
  publicIngestEndpoint,
} from '../lib/bot-ingest.js';
import { LogTooLargeError, readSenderBody } from '../lib/bot-log-formats.js';
import { WORKER_SECRET_NAME, buildWorkerScript } from '../lib/bot-worker-script.js';
import { FASTLY_LOG_FORMAT, logpushJob, vercelDrain } from '../lib/bot-sender-setup.js';
import { botUploadLimiter } from '../middleware/rate-limiter.js';

const router = Router();

const WRITE_ROLES = ['admin', 'manager'];

/** Postgres' unique_violation. */
const UNIQUE_VIOLATION = '23505';

const createSchema = z.object({ kind: z.enum(CONNECTION_KINDS) });

async function assertWriter(userId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!WRITE_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can manage AI bot connections.');
    err.status = 403;
    throw err;
  }
}

function fail(req, res, error, what) {
  if (error instanceof PlanLimitError) {
    return res.status(error.statusCode).json({ error: 'plan_limit', message: error.message });
  }
  const status = error.status || 500;
  if (status >= 500) req.log.error({ err: error }, `${what} error`);
  return res.status(status).json({ error: error.message || `Failed to ${what}` });
}

router.get('/connections/:brandId', async (req, res) => {
  try {
    const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const [{ data: connections, error }, { data: usage }, caps] = await Promise.all([
      supabaseAdmin
        .from('ai_bot_connections')
        .select('id, kind, created_at, last_event_at')
        .eq('brand_id', brand.id)
        .is('revoked_at', null)
        // Uploads have their own connection, never one to set up or revoke.
        .neq('kind', UPLOAD_KIND)
        .order('created_at'),
      supabaseAdmin
        .from('ai_bot_usage')
        .select('stored_events, counted_events, capped_at, raw_records, raw_capped_at')
        .eq('organization_id', brand.organization_id)
        .eq('month', month)
        .maybeSingle(),
      // Read-only once the plan has ended (2026-10-27): no plan reads as caps
      // of 0, and the connections and this month's use still come back.
      getBotCaps(brand.organization_id, { readOnly: true }),
    ]);
    if (error) throw new Error(error.message);
    const { cap, rawCap, noPlan } = caps;
    return res.json({
      connections: connections ?? [],
      usage: {
        month,
        stored: usage?.stored_events ?? 0,
        counted: usage?.counted_events ?? 0,
        cappedAt: usage?.capped_at ?? null,
        cap,
        // A Logpush job's or a Vercel drain's records (00184): past rawCap the
        // files are counted but not read, so the report stops until the month ends.
        raw: usage?.raw_records ?? 0,
        rawCappedAt: usage?.raw_capped_at ?? null,
        rawCap,
        ...(noPlan ? { noPlan: true } : {}),
      },
    });
  } catch (error) {
    return fail(req, res, error, 'load AI bot connections');
  }
});

router.post('/connections/:brandId', async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
    await assertWriter(req.user.id);
    if ((await getBotEventCap(brand.organization_id)) === 0) {
      throw new PlanLimitError('The AI bot report comes with the Growth plan.', 403);
    }
    // Checked before a connection exists: one the sender can't reach is no use.
    const endpoint = publicIngestEndpoint();
    if (!endpoint) {
      req.log.error('[ai-bots] PUBLIC_SERVER_URL is missing or not https');
      return res
        .status(503)
        .json({ error: 'AI bot connections are not set up on this server yet.' });
    }

    const secret = newConnectionSecret();
    const { data: connection, error } = await supabaseAdmin
      .from('ai_bot_connections')
      .insert({
        brand_id: brand.id,
        kind: parsed.data.kind,
        secret_hash: hashSecret(secret),
        created_by: req.user.id,
      })
      .select('id, kind, created_at, last_event_at')
      .single();
    if (error) throw new Error(error.message);

    const { kind } = parsed.data;
    // What the person copies into Cloudflare, Vercel or Fastly, with the secret in it once.
    return res.status(201).json({
      connection,
      secret,
      endpoint,
      // The Worker reads the secret from a Secret of this name, not from its code.
      workerScript: kind === 'cloudflare_worker' ? buildWorkerScript({ endpoint }) : null,
      workerSecretName: kind === 'cloudflare_worker' ? WORKER_SECRET_NAME : null,
      logpushJob: kind === 'cloudflare_logpush' ? logpushJob({ endpoint, secret }) : null,
      vercelDrain: kind === 'vercel_drain' ? vercelDrain({ endpoint, secret }) : null,
      fastlyLogFormat: kind === 'fastly_log_stream' ? FASTLY_LOG_FORMAT : null,
    });
  } catch (error) {
    return fail(req, res, error, 'create the AI bot connection');
  }
});

router.delete('/connections/:brandId/:id', async (req, res) => {
  try {
    const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
    await assertWriter(req.user.id);
    const { data, error } = await supabaseAdmin
      .from('ai_bot_connections')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('brand_id', brand.id)
      .is('revoked_at', null)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) return res.status(404).json({ error: 'Connection not found' });
    return res.status(204).end();
  } catch (error) {
    return fail(req, res, error, 'revoke the AI bot connection');
  }
});

/** A live upload connection of the brand, or null. */
async function findUploadConnection(brandId) {
  const { data, error } = await supabaseAdmin
    .from('ai_bot_connections')
    .select('id')
    .eq('brand_id', brandId)
    .eq('kind', UPLOAD_KIND)
    .is('revoked_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/**
 * The brand's upload connection (00492): one per brand, made at its first
 * upload. Its secret is never shown: a person uploads through the app.
 */
async function uploadConnection(brand, userId) {
  let id = await findUploadConnection(brand.id);
  if (!id) {
    const made = await supabaseAdmin
      .from('ai_bot_connections')
      .insert({
        brand_id: brand.id,
        kind: UPLOAD_KIND,
        secret_hash: hashSecret(newConnectionSecret()),
        created_by: userId,
      })
      .select('id')
      .single();
    // Another upload made it a moment ago (00492's unique index): that one.
    if (made.error?.code === UNIQUE_VIOLATION) id = await findUploadConnection(brand.id);
    else if (made.error) throw new Error(made.error.message);
    else id = made.data.id;
    if (!id) throw new Error('The upload connection could not be made');
  }
  const { data: domains, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brand.id);
  if (error) throw new Error(error.message);
  return {
    id,
    brandId: brand.id,
    kind: UPLOAD_KIND,
    organizationId: brand.organization_id,
    domains: (domains ?? []).map((d) => d.domain).filter(Boolean),
  };
}

/**
 * Who may upload, checked before the file is read, as /bots/ingest checks a
 * sender's secret first: the brand's admins and managers, on a plan with the
 * bot report. The brand goes on in res.locals.
 */
function uploaderOnly() {
  return async (req, res, next) => {
    try {
      const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
      await assertWriter(req.user.id);
      if ((await getBotEventCap(brand.organization_id)) === 0) {
        throw new PlanLimitError('The AI bot report comes with the Growth plan.', 403);
      }
      res.locals.brand = brand;
      return next();
    } catch (error) {
      return fail(req, res, error, 'read the uploaded log');
    }
  };
}

// The file as sent, gzipped or not, up to the senders' own limit. The web
// sends at most what its proxy takes (4 MB, web/src/lib/bot-log-upload.ts).
const uploadBody = express.raw({ type: () => true, limit: '20mb' });

router.post('/upload/:brandId', botUploadLimiter, uploaderOnly(), uploadBody, async (req, res) => {
  try {
    const { brand } = res.locals;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'empty_file' });
    }
    const connection = await uploadConnection(brand, req.user.id);
    // A file uploaded again is read once, as a log sender's.
    const hash = logFileHash(req.body);
    if (await logFileRead(connection, hash)) {
      return res.json({ received: 0, verified: 0, stored: 0, duplicate: true });
    }
    let parsed;
    try {
      parsed = await readSenderBody(UPLOAD_KIND, req.body);
    } catch (err) {
      if (err instanceof LogTooLargeError) {
        return res.status(413).json({ error: 'too_large', message: err.message });
      }
      // Not an access log or JSON lines, or a broken gzip: nothing counted.
      return res.status(400).json({ error: 'unreadable_file' });
    }
    // Counted against the month's raw cap, as a log sender's file (00189).
    const result = await ingestLogFile(connection, hash, parsed);
    return res.json({ ...result, records: parsed.records });
  } catch (error) {
    return fail(req, res, error, 'read the uploaded log');
  }
});

export default router;