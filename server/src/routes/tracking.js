import { Router } from 'express';
import { createJob, getJob, cancelJob } from '../lib/job-manager.js';
import { runTrackingJob } from '../lib/job-runner.js';
import supabaseAdmin from '../config/supabase.js';
import { enforceOnDemandTrackingQuota, TrackingQuotaError } from '../lib/tracking-quota.js';
import { assertBrandAccess } from '../lib/access.js';

const router = Router();

/**
 * POST /api/tracking/check
 * Body: { brandId, platformId?, promptId? }
 * Enqueues an immediate tracking job.
 */
router.post('/check', async (req, res) => {
  try {
    const { brandId, promptId } = req.body;

    if (!brandId) {
      return res.status(400).json({ success: false, message: 'brandId is required' });
    }

    // Verify the user owns this brand
    const { data: brand, error: brandErr } = await supabaseAdmin
      .from('brands')
      .select('id, organization_id, is_active')
      .eq('id', brandId)
      .single();

    if (brandErr || !brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.organization_id !== brand.organization_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // A paused brand spends nothing — block on-demand runs too, not just the
    // daily cron. Resume the brand to track it again.
    if (brand.is_active === false) {
      return res.status(409).json({
        success: false,
        message: 'This brand is paused. Resume it to run tracking.',
      });
    }

    // Same cloud-mode cost controls as /analyze-new — this endpoint also
    // enqueues a real (full-brand when no promptId) tracking run.
    await enforceOnDemandTrackingQuota(brandId, brand.organization_id);

    const job = await createJob({
      type: 'tracking',
      brandId,
      data: { brandId, promptId: promptId || null, immediate: true, onDemand: true },
      maxAttempts: 3,
    });

    const io = req.app.get('io');
    runTrackingJob(job.id, io);

    return res.json({
      success: true,
      jobId: job.id,
      message: 'Tracking job enqueued',
    });
  } catch (error) {
    if (error instanceof TrackingQuotaError) {
      return res.status(error.statusCode).json(error.body);
    }
    req.log.error({ err: error }, 'tracking check error');
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/tracking/analyze-new
 * Body: { brandId }
 * Finds prompts with no results yet and runs tracking only for those.
 * Enforces daily on-demand limit and cooldown in cloud mode.
 */
router.post('/analyze-new', async (req, res) => {
  try {
    const { brandId, promptIds: clientPromptIds } = req.body;
    if (!brandId) {
      return res.status(400).json({ success: false, message: 'brandId is required' });
    }

    const { data: brand, error: brandErr } = await supabaseAdmin
      .from('brands')
      .select('id, organization_id, is_active')
      .eq('id', brandId)
      .single();

    if (brandErr || !brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.organization_id !== brand.organization_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // A paused brand spends nothing — block on-demand runs too, not just the
    // daily cron. Resume the brand to track it again.
    if (brand.is_active === false) {
      return res.status(409).json({
        success: false,
        message: 'This brand is paused. Resume it to run tracking.',
      });
    }

    // Build the candidate set: either the specific IDs the client picked
    // (validated against this brand) or every active prompt for the brand.
    let candidateIds;

    const { data: promptSets } = await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .eq('brand_id', brandId);

    if (!promptSets || promptSets.length === 0) {
      return res.json({ success: true, newCount: 0, message: 'No prompt sets found' });
    }

    const setIds = promptSets.map((s) => s.id);

    if (Array.isArray(clientPromptIds) && clientPromptIds.length > 0) {
      // Client sent specific prompt IDs — validate they belong to this brand.
      const { data: validPrompts } = await supabaseAdmin
        .from('prompts')
        .select('id')
        .in('prompt_set_id', setIds)
        .in('id', clientPromptIds)
        .eq('is_active', true);

      candidateIds = (validPrompts || []).map((p) => p.id);
    } else {
      // Auto-detect: start from every active prompt for the brand.
      const { data: allPrompts } = await supabaseAdmin
        .from('prompts')
        .select('id')
        .in('prompt_set_id', setIds)
        .eq('is_active', true);

      if (!allPrompts || allPrompts.length === 0) {
        return res.json({ success: true, newCount: 0, message: 'No active prompts' });
      }

      candidateIds = allPrompts.map((p) => p.id);
    }

    // Never (re)analyze a prompt that already has results for this brand — this
    // endpoint is "analyze NEW prompts" only (full re-runs go through /check and
    // the daily scheduled job). Applying the filter to BOTH branches is what
    // stops the client from re-submitting IDs read from a stale "unanalyzed"
    // dialog while an earlier on-demand run's async webhook results are still
    // landing, which previously caused duplicate Cloro/LLM spend.
    let newPromptIds = candidateIds;
    if (candidateIds.length > 0) {
      const { data: existingResults } = await supabaseAdmin
        .from('prompt_results')
        .select('prompt_id')
        .eq('brand_id', brandId)
        .in('prompt_id', candidateIds);

      const analyzedIds = new Set((existingResults || []).map((r) => r.prompt_id));
      newPromptIds = candidateIds.filter((id) => !analyzedIds.has(id));
    }

    if (newPromptIds.length === 0) {
      return res.json({ success: true, newCount: 0, message: 'All prompts already analyzed' });
    }

    // --- Cloud-mode subscription gate + rate limiting (shared with /check) ---
    await enforceOnDemandTrackingQuota(brandId, brand.organization_id);

    const job = await createJob({
      type: 'tracking',
      brandId,
      data: { brandId, promptIds: newPromptIds, immediate: true, onDemand: true },
      maxAttempts: 3,
    });

    const io = req.app.get('io');
    runTrackingJob(job.id, io);

    return res.json({
      success: true,
      jobId: job.id,
      newCount: newPromptIds.length,
      message: `Analyzing ${newPromptIds.length} new prompt${newPromptIds.length !== 1 ? 's' : ''}`,
    });
  } catch (error) {
    if (error instanceof TrackingQuotaError) {
      return res.status(error.statusCode).json(error.body);
    }
    req.log.error({ err: error }, 'tracking analyze-new error');
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/tracking/unanalyzed/:brandId
 * Returns the list of active prompts that have no results yet.
 */
router.get('/unanalyzed/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);

    const { data: promptSets } = await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .eq('brand_id', brandId);

    if (!promptSets || promptSets.length === 0) {
      return res.json({ success: true, count: 0, prompts: [] });
    }

    const setIds = promptSets.map((s) => s.id);
    const { data: allPrompts } = await supabaseAdmin
      .from('prompts')
      .select('id, text, category')
      .in('prompt_set_id', setIds)
      .eq('is_active', true);

    if (!allPrompts || allPrompts.length === 0) {
      return res.json({ success: true, count: 0, prompts: [] });
    }

    const allPromptIds = allPrompts.map((p) => p.id);

    const { data: existingResults } = await supabaseAdmin
      .from('prompt_results')
      .select('prompt_id')
      .eq('brand_id', brandId)
      .in('prompt_id', allPromptIds);

    const analyzedIds = new Set((existingResults || []).map((r) => r.prompt_id));
    const unanalyzed = allPrompts.filter((p) => !analyzedIds.has(p.id));

    return res.json({ success: true, count: unanalyzed.length, prompts: unanalyzed });
  } catch (error) {
    req.log.error({ err: error }, 'tracking unanalyzed error');
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/tracking/results/:brandId
 * Query: ?limit=20&offset=0&promptId=xxx&platform=chatgpt
 */
router.get('/results/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = parseInt(req.query.offset || '0', 10);
    const { promptId, platform } = req.query;

    // Verify ownership
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id, organization_id')
      .eq('id', brandId)
      .single();

    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.organization_id !== brand.organization_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    let query = supabaseAdmin
      .from('prompt_results')
      .select('*', { count: 'exact' })
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (promptId) query = query.eq('prompt_id', promptId);
    if (platform) query = query.eq('platform', platform);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ success: true, results: data, total: count });
  } catch (error) {
    req.log.error({ err: error }, 'tracking results error');
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/tracking/status/:brandId
 * Returns the latest check timestamps per platform.
 */
router.get('/status/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);

    const { data: platforms, error } = await supabaseAdmin
      .from('brand_platforms')
      .select('id, platform, is_enabled, last_checked_at, check_frequency, api_model')
      .eq('brand_id', brandId)
      .eq('is_enabled', true);

    if (error) throw error;

    return res.json({ success: true, platforms: platforms || [] });
  } catch (error) {
    req.log.error({ err: error }, 'tracking status error');
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/tracking/job/:jobId
 * Returns job state and progress for live tracking UI.
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) {
      return res.json({ success: true, status: 'not_found' });
    }

    await assertBrandAccess(job.brand_id, req.user.id);

    return res.json({
      success: true,
      status: job.status,
      progress: job.progress || {},
      result: job.status === 'completed' ? job.result : null,
      failedReason: job.status === 'failed' ? job.failed_reason : null,
    });
  } catch (error) {
    req.log.error({ err: error }, 'tracking job status error');
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/tracking/job/:jobId
 * Cancels a tracking job.
 */
router.delete('/job/:jobId', async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (job) {
      await assertBrandAccess(job.brand_id, req.user.id);
    }
    await cancelJob(req.params.jobId);
    return res.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    req.log.error({ err: error }, 'tracking job cancel error');
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

export default router;
