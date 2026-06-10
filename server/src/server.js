import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { Server as SocketIOServer } from 'socket.io';
import cron from 'node-cron';

import Middleware from './middleware/index.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import routes from './routes/index.js';
import trafficRoutes from './routes/traffic.js';
import { createJob, cleanupStaleJobs, cleanupOldJobs } from './lib/job-manager.js';
import { runTrackingJob } from './lib/job-runner.js';
import { parseScraperResponse } from './lib/cloro-scraper.js';
import { handleScraperResult } from './lib/cloro-result-handler.js';
import { generateBriefForOpportunity } from './routes/content.js';
import supabaseAdmin from './config/supabase.js';
import { getPlan, hasFeature, isCloud, isSubscriptionActive } from './config/plans.js';

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// --- Body parsing (before all routes) ---
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// --- Public traffic tracking (before helmet/cors — needs its own CORS for any origin) ---
app.use('/', trafficRoutes);

// --- Request logger (before everything to catch all requests) ---
app.use((req, res, next) => {
  console.log(`[req] ${req.method} ${req.path} | origin: ${req.headers.origin} | ip: ${req.ip}`);
  next();
});

// --- CORS (for dashboard API only — after traffic routes) ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

console.log('[cors] Allowed origins:', allowedOrigins);

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
  console.log(`Socket connected: ${socket.id} (user: ${socket.user?.id})`);

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Make io accessible to routes
app.set('io', io);

// --- Daily tracking logic (shared by internal endpoint and self-hosted cron) ---
async function runDailyTracking() {
  const isCloudMode = isCloud();

  const { data: brands, error } = await supabaseAdmin.from('brands').select('id, organization_id');

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

  console.log(`[cron] Daily tracking: triggered=${triggered} total_brands=${brands.length}`);
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
    console.error('[cron] Daily tracking error:', err.message);
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
    console.error('[internal] content brief error:', err.message);
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
    console.error('[internal] trigger-tracking error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- Cloro webhook callback (public, no auth — security via task_id entropy + DB lookup) ---
app.post('/cloro/callback', async (req, res) => {
  // Always ack quickly so Cloro doesn't retry on slow processing
  res.status(200).send();

  try {
    const { task, response } = req.body || {};
    const taskId = task?.id;
    const status = task?.status;

    if (!taskId) {
      console.warn('[cloro/callback] Missing task.id in payload');
      return;
    }

    const { data: pending } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle();

    if (!pending) {
      console.log(`[cloro/callback] No pending task for ${taskId} (already processed?)`);
      return;
    }

    if (status === 'FAILED') {
      console.error(`[cloro/callback] Task ${taskId} (${pending.scraper_id}) FAILED`);
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    if (status !== 'COMPLETED') {
      console.log(`[cloro/callback] Task ${taskId} status=${status}, ignoring`);
      return;
    }

    if (!response) {
      console.error(`[cloro/callback] Task ${taskId} COMPLETED but missing response`);
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
      console.error(
        `[cloro/callback] Brand ${pending.brand_id} for task ${taskId} not found — dropping`,
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

    console.log(`[cloro/callback] Task ${taskId} (${pending.scraper_id}) processed and inserted`);
  } catch (err) {
    console.error('[cloro/callback] Error processing webhook:', err?.message || err);
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
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
  });
});

// --- Start ---
const PORT = process.env.PORT || 80;

server.listen(PORT, async () => {
  console.log(`AEO Server running on port ${PORT} [${process.env.NODE_ENV}]`);

  await cleanupStaleJobs();

  if (!isCloud()) {
    const schedule = process.env.DAILY_CRON_SCHEDULE || '0 6 * * *';
    cron.schedule(schedule, async () => {
      console.log('[cron] Self-hosted daily tracking triggered');
      try {
        await runDailyTracking();
        await cleanupOldJobs();
      } catch (err) {
        console.error('[cron] Self-hosted daily tracking failed:', err.message);
      }
    });
    console.log(`[cron] Self-hosted daily cron active (schedule: ${schedule})`);
  }
});

export { app, server, io };
