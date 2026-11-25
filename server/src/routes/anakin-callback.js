/**
 * POST /anakin/callback — Anakin's finished job, for a task a run submitted
 * with ANAKIN_WEBHOOK_URL (PLATFORM_PROVIDER=anakin). The same steps as
 * Cloro's /cloro/callback: find the task among the pending ones, store its
 * answer through cloro-result-handler.js, and drop the pending row, which
 * tells the run's drain loop the task is done.
 *
 * Deliveries (anakin.io/docs/api-reference/webhooks/events):
 *   { id, type: 'wire.job.completed' | 'wire.job.failed', createdAt,
 *     data: { jobId, status, result?, resultOmitted?, result_url, error? } }
 * `result` is the finished job, inlined up to 256 KB; a larger one is read
 * from Anakin. Delivery is at least once: a repeat finds no pending row.
 *
 * Takes Anakin's own tasks only: cloro_pending_tasks also holds Cloro's, and
 * each row says whose it is (00562; null is Cloro's), so a delivery for
 * another provider's task stores and drops nothing. Every delivery must be
 * signed with ANAKIN_WEBHOOK_SECRET (anakin-webhook-verify.js); without the
 * secret nothing is accepted, and runs poll instead (answer-providers/
 * anakin.js sends no webhook URL).
 * Mounted in server.js after the raw body parser for this
 * path, which keeps the bytes as sent for the signature.
 */

import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import { loadTrackedCompetitors } from '../lib/competitor-aliases.js';
import { fetchJob, parseScraperResponse } from '../lib/anakin-scraper.js';
import { handleScraperResult } from '../lib/cloro-result-handler.js';
import { verifyAnakinWebhook } from '../lib/anakin-webhook-verify.js';
import { isBrandActive, isBrandActiveCached } from '../lib/active-subscriptions.js';

const router = Router();

/**
 * Whether a brand's answer is dropped because its plan has ended: as on
 * Cloro's route, a kept "active" lets it through, dropping is decided on a
 * fresh read, and a read that fails stores the answer.
 */
async function droppedForPlan(brandId, log) {
  try {
    if (await isBrandActiveCached(brandId)) return false;
    return !(await isBrandActive(brandId));
  } catch (err) {
    log.warn({ err, brandId }, 'anakin callback: plan check failed; stored as usual');
    return false;
  }
}

const forget = (taskId) => supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);

router.post('/', async (req, res) => {
  const webhookSecret = process.env.ANAKIN_WEBHOOK_SECRET;
  if (!webhookSecret) {
    req.log.warn({ ip: req.ip }, 'anakin callback refused: ANAKIN_WEBHOOK_SECRET is not set');
    return res.status(503).json({ error: 'webhook signing secret not configured' });
  }
  const verdict = verifyAnakinWebhook({
    rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
    signatureHeader: req.headers['x-anakin-signature'],
    secret: webhookSecret,
  });
  if (!verdict.ok) {
    req.log.warn(
      {
        reason: verdict.reason,
        deliveryId: req.headers['x-anakin-delivery-id'] || null,
        ip: req.ip,
      },
      'anakin callback rejected delivery',
    );
    return res.status(verdict.status).json({ error: verdict.reason });
  }

  let payload;
  try {
    payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}') : req.body;
  } catch {
    req.log.warn({ ip: req.ip }, 'anakin callback rejected: malformed JSON body');
    return res.status(400).json({ error: 'malformed JSON body' });
  }

  // Ack at once: Anakin waits 10 s for an answer before it tries again.
  res.status(200).send();

  try {
    const event = payload?.data ?? {};
    const taskId = event.jobId;
    if (!taskId) {
      req.log.warn({ type: payload?.type }, 'anakin callback missing data.jobId');
      return;
    }

    const { data: pending } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle();
    if (!pending) {
      req.log.info({ taskId }, 'anakin callback: no pending task (already processed?)');
      return;
    }

    if (pending.provider !== 'anakin') {
      req.log.warn(
        { taskId, provider: pending.provider ?? 'cloro' },
        'anakin callback: task belongs to another provider; ignored',
      );
      return;
    }

    if (payload.type === 'wire.job.failed' || event.status === 'failed') {
      req.log.error(
        { taskId, scraperId: pending.scraper_id, error: event.error ?? null },
        'anakin callback: job failed',
      );
      await forget(taskId);
      return;
    }

    if (await droppedForPlan(pending.brand_id, req.log)) {
      req.log.info(
        { taskId, scraperId: pending.scraper_id, brandId: pending.brand_id },
        'anakin callback: dropped, no active plan',
      );
      await forget(taskId);
      return;
    }

    let job = event.result ?? null;
    if (!job) {
      try {
        job = await fetchJob(taskId);
      } catch (err) {
        req.log.error({ err, taskId }, 'anakin callback: could not read the finished job');
        await forget(taskId);
        return;
      }
    }

    const [{ data: brand }, { data: domains }, competitors] = await Promise.all([
      supabaseAdmin.from('brands').select('id, name').eq('id', pending.brand_id).single(),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', pending.brand_id),
      loadTrackedCompetitors(pending.brand_id),
    ]);
    if (!brand) {
      req.log.error(
        { taskId, brandId: pending.brand_id },
        'anakin callback: brand not found — dropping',
      );
      await forget(taskId);
      return;
    }

    // A finished job with nothing to store (no AI Overview, no Naver AI
    // Briefing) is a done task: its row goes, so the run isn't held open.
    let aiResponse;
    try {
      aiResponse = parseScraperResponse(job, pending.scraper_id);
    } catch (err) {
      req.log.info(
        { taskId, scraperId: pending.scraper_id, reason: err.message },
        'anakin callback: job finished with no answer to store',
      );
      await forget(taskId);
      return;
    }

    try {
      await handleScraperResult({
        aiResponse,
        scraperId: pending.scraper_id,
        promptId: pending.prompt_id,
        brandId: pending.brand_id,
        region: pending.region,
        brandInfo: { brandName: brand.name, domains: (domains || []).map((d) => d.domain) },
        competitors,
      });
    } finally {
      await forget(taskId);
    }

    req.log.info(
      { taskId, scraperId: pending.scraper_id, credits: job?.credits_used ?? null },
      'anakin callback: job processed and inserted',
    );
  } catch (err) {
    req.log.error({ err }, 'anakin callback: error processing webhook');
  }
});

export default router;
