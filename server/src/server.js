import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { Server as SocketIOServer } from 'socket.io';
import cron from 'node-cron';

import logger from './lib/logger.js';
import Middleware from './middleware/index.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import requestIdMiddleware from './middleware/request-id.js';
import routes from './routes/index.js';
import trafficRoutes from './routes/traffic.js';
import {
  createJob,
  cleanupStaleJobs,
  cleanupOldJobs,
  cleanupStalePendingTasks,
} from './lib/job-manager.js';
import { runTrackingJob } from './lib/job-runner.js';
import { parseScraperResponse } from './lib/cloro-scraper.js';
import { handleScraperResult } from './lib/cloro-result-handler.js';
import { verifyCloroWebhook } from './lib/cloro-webhook-verify.js';
import { generateBriefForOpportunity } from './routes/content.js';
import { startSiteAuditForBrand } from './routes/audits.js';
import { getSiteAuditQuotaStatus } from './lib/plan-guard.js';
import supabaseAdmin from './config/supabase.js';
import { getPlan, hasFeature, isCloud, isSubscriptionActive } from './config/plans.js';

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// --- Body parsing (before all routes) ---
// /cloro/callback gets the raw body bytes: HMAC signature verification needs the
// payload exactly as sent, and express.json()'s parse/re-serialize would break it.
// Mounted first so the global JSON parser skips this path (body already consumed).
app.use('/cloro/callback', express.raw({ type: 'application/json', limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// --- Public traffic tracking (before helmet/cors — needs its own CORS for any origin) ---
app.use('/', trafficRoutes);

// --- Request logger (before everything to catch all requests) ---
app.use(requestIdMiddleware);
app.use((req, res, next) => {
  req.log.debug(
    { method: req.method, path: req.path, origin: req.headers.origin, ip: req.ip },
    'incoming request',
  );
  next();
});

// --- CORS (for dashboard API only — after traffic routes) ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

logger.info({ allowedOrigins }, 'CORS configured');

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// --- Security ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

// --- Rate limiting ---
app.use('/api', apiLimiter);

// --- Socket.IO ---
const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.use((socket, next) => Middleware.checkRequestIsComingFromDomainForSocket(socket, next));
io.use((socket, next) => Middleware.decodeTokenForSocket(socket, next));

io.on('connection', (socket) => {
  logger.debug({ socketId: socket.id, userId: socket.user?.id }, 'socket connected');

  socket.on('disconnect', () => {
    logger.debug({ socketId: socket.id }, 'socket disconnected');
  });
});

// Make io accessible to routes
app.set('io', io);

// --- Daily tracking logic (shared by internal endpoint and self-hosted cron) ---
async function runDailyTracking() {
  const isCloudMode = isCloud();

  // Sweep orphaned Cloro pending tasks daily (runs in both cloud and
  // self-hosted, since both paths funnel through here).
  await cleanupStalePendingTasks();

  // Skip paused brands (is_active = false): the user has explicitly suspended
  // tracking for them, so they should not spend Cloro / LLM credits daily.
  const { data: brands, error } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .eq('is_active', true);

  if (error || !brands || brands.length === 0) {
    return { triggered: 0, total: 0 };
  }

  const orgPlanCache = {};
  let triggered = 0;

  for (const brand of brands) {
    if (!orgPlanCache[brand.organization_id]) {
      if (!isCloudMode) {
        orgPlanCache[brand.organization_id] = getPlan('self_hosted');
      } else {
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('plan, subscription_status')
          .eq('id', brand.organization_id)
          .single();
        // Skip orgs without an active or trialing Stripe subscription.
        // Previously this fell back to starter limits, which silently kept
        // running daily monitoring (and Cloro / AI provider spend) for
        // unsubscribed signups.
        if (!isSubscriptionActive(org?.subscription_status)) {
          orgPlanCache[brand.organization_id] = null;
        } else {
          orgPlanCache[brand.organization_id] = getPlan(org.plan);
        }
      }
    }

    const plan = orgPlanCache[brand.organization_id];
    if (!plan) continue; // unsubscribed → skip silently
    if (!hasFeature(plan, 'daily_monitoring')) continue;

    const { count } = await supabaseAdmin
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
      .eq('prompt_sets.brand_id', brand.id)
      .eq('is_active', true);

    if ((count || 0) === 0) continue;

    const job = await createJob({
      type: 'tracking',
      brandId: brand.id,
      data: { brandId: brand.id, immediate: false },
      maxAttempts: 3,
    });
    runTrackingJob(job.id, io);
    triggered++;
  }

  logger.info({ triggered, total: brands.length }, 'daily tracking triggered');
  return { triggered, total: brands.length };
}

// --- Internal cron endpoint (CRON_SECRET auth, used by Vercel Cron in cloud mode) ---
app.post('/api/internal/daily-tracking', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const result = await runDailyTracking();
    return res.json({ success: true, ...result });
  } catch (err) {
    req.log.error({ err }, 'daily tracking error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal content-brief endpoint (CRON_SECRET auth, called by web MCP layer) ---
// The web layer's MCP route does the org-ownership check *before* hitting
// this endpoint — it can't reach here unless the authenticated `ans_` API
// key belongs to the same org as the opportunity. So this endpoint just
// trusts the secret and runs the LLM. Always passes force=true to bypass
// the cached-brief early-return (MCP callers want a fresh brief; for
// cached reads they should use get_content_opportunity instead).
app.post('/api/internal/content/:id/brief', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { id } = req.params;
    const { force, model } = req.body || {};
    const result = await generateBriefForOpportunity(id, {
      force: Boolean(force),
      model,
    });
    return res.json({
      success: true,
      brief: result.brief,
      generated_at: result.generated_at,
      regenerated: result.regenerated,
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    // PlanLimitError (brief quota exhausted / inactive subscription) carries
    // a statusCode — surface it so the MCP layer can relay a clear message.
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'internal content brief error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal site-audit endpoint (CRON_SECRET auth, called by web MCP layer) ---
// The web MCP layer verifies the caller's `ans_` API key org owns `brandId`
// before reaching here, so this endpoint just trusts the secret, resolves the
// brand's org, enforces the monthly Site Audit quota, and starts the detached
// audit job — returning the new `running` audit (the MCP caller then polls
// get_site_audit for the result).
app.post('/api/internal/site-audits', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { brandId, url } = req.body || {};
    if (!brandId || !url) {
      return res.status(400).json({ success: false, message: 'brandId and url are required' });
    }
    const audit = await startSiteAuditForBrand(brandId, url);
    return res.status(202).json({ success: true, audit });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    // PlanLimitError (audit quota exhausted / inactive subscription) carries a
    // statusCode — surface it so the MCP layer can relay a clear message.
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'internal site audit error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal site-audit quota endpoint (CRON_SECRET auth, called by web MCP layer) ---
// Read-only: returns the org's monthly Site Audit allowance via the same
// getSiteAuditQuotaStatus the dashboard uses, so the MCP `get_site_audit_quota`
// tool shares one source of truth for plan limits + usage counting. The web
// MCP layer passes its authenticated org id.
app.get('/api/internal/site-audit-quota', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    // Express gives an array when a query param is repeated; take the first so
    // a single string always reaches getSiteAuditQuotaStatus.
    const raw = req.query.orgId;
    const orgId = Array.isArray(raw) ? raw[0] : raw;
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'orgId is required' });
    }
    const quota = await getSiteAuditQuotaStatus(orgId);
    return res.json({ success: true, quota });
  } catch (err) {
    if (err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'internal site audit quota error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Internal trigger-tracking endpoint (CRON_SECRET auth, called by Stripe success route) ---
app.post('/api/internal/trigger-tracking', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { brandId } = req.body;
    if (!brandId) {
      return res.status(400).json({ success: false, message: 'brandId is required' });
    }

    const job = await createJob({
      type: 'tracking',
      brandId,
      data: { brandId, immediate: true },
      maxAttempts: 3,
    });
    runTrackingJob(job.id, io);

    return res.json({ success: true, jobId: job.id });
  } catch (err) {
    req.log.error({ err }, 'internal trigger-tracking error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Cloro webhook callback ---
// Signature verification (HMAC-SHA256, see lib/cloro-webhook-verify.js) runs when
// CLORO_WEBHOOK_SECRET is set. When it's unset (self-hosted installs, or signing not
// yet enabled in the Cloro dashboard) we fall back to the original defence:
// task_id entropy + cloro_pending_tasks lookup.
app.post('/cloro/callback', async (req, res) => {
  const webhookSecret = process.env.CLORO_WEBHOOK_SECRET;
  if (webhookSecret) {
    const verdict = verifyCloroWebhook({
      rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
      signatureHeader: req.headers['x-cloro-signature'],
      timestampHeader: req.headers['x-cloro-timestamp'],
      secret: webhookSecret,
    });
    if (!verdict.ok) {
      req.log.warn(
        {
          reason: verdict.reason,
          webhookId: req.headers['x-cloro-webhook-id'] || null,
          ip: req.ip,
        },
        'cloro callback rejected delivery',
      );
      return res.status(verdict.status).json({ error: verdict.reason });
    }
  }

  // Parse only after the signature check has passed (raw body arrives as a Buffer).
  let payload;
  try {
    payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}') : req.body;
  } catch {
    req.log.warn({ ip: req.ip }, 'cloro callback rejected: malformed JSON body');
    return res.status(400).json({ error: 'malformed JSON body' });
  }

  // Always ack quickly so Cloro doesn't retry on slow processing
  res.status(200).send();

  try {
    const { task, response } = payload || {};
    const taskId = task?.id;
    const status = task?.status;

    if (!taskId) {
      req.log.warn('cloro callback missing task.id in payload');
      return;
    }

    const { data: pending } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle();

    if (!pending) {
      req.log.info({ taskId }, 'cloro callback: no pending task (already processed?)');
      return;
    }

    if (status === 'FAILED') {
      req.log.error({ taskId, scraperId: pending.scraper_id }, 'cloro callback: task failed');
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    if (status !== 'COMPLETED') {
      req.log.info({ taskId, status }, 'cloro callback: task status ignored');
      return;
    }

    if (!response) {
      req.log.error({ taskId }, 'cloro callback: task completed but missing response');
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    // Fetch context for result handler
    const [{ data: brand }, { data: domains }, { data: competitorRows }] = await Promise.all([
      supabaseAdmin.from('brands').select('id, name').eq('id', pending.brand_id).single(),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', pending.brand_id),
      supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', pending.brand_id),
    ]);

    if (!brand) {
      req.log.error(
        { taskId, brandId: pending.brand_id },
        'cloro callback: brand not found — dropping',
      );
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    const brandInfo = {
      brandName: brand.name,
      domains: (domains || []).map((d) => d.domain),
    };
    const competitors = (competitorRows || []).map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain || '',
    }));

    const aiResponse = parseScraperResponse(response, pending.scraper_id);

    await handleScraperResult({
      aiResponse,
      scraperId: pending.scraper_id,
      promptId: pending.prompt_id,
      brandId: pending.brand_id,
      region: pending.region,
      brandInfo,
      competitors,
    });

    await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);

    req.log.info(
      { taskId, scraperId: pending.scraper_id },
      'cloro callback: task processed and inserted',
    );
  } catch (err) {
    req.log.error({ err }, 'cloro callback: error processing webhook');
  }
});

// --- Authenticated API routes ---
app.use('/api', Middleware.decodeToken.bind(Middleware), routes);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'aeo-server',
    mode: process.env.IS_CLOUD === 'true' ? 'cloud' : 'self-hosted',
    timestamp: new Date().toISOString(),
  });
});

// --- Global error handler ---
app.use((err, req, res, _next) => {
  // Module logger, not req.log: an error thrown before requestIdMiddleware
  // (e.g. in the public traffic routes or body parser) has no req.log.
  logger.error({ err }, 'unhandled error');
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
  });
});

// --- Start ---
const PORT = process.env.PORT || 80;

server.listen(PORT, async () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, 'server running');

  await cleanupStaleJobs();
  await cleanupStalePendingTasks();

  if (!isCloud()) {
    const schedule = process.env.DAILY_CRON_SCHEDULE || '0 6 * * *';
    cron.schedule(schedule, async () => {
      logger.info('self-hosted daily tracking triggered');
      try {
        await runDailyTracking();
        await cleanupOldJobs();
      } catch (err) {
        logger.error({ err }, 'self-hosted daily tracking failed');
      }
    });
    logger.info({ schedule }, 'self-hosted daily cron active');
  }
});

export { app, server, io };
