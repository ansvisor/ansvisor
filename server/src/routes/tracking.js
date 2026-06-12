import { Router } from 'express';
import { createJob, getJob, cancelJob } from '../lib/job-manager.js';
import { runTrackingJob } from '../lib/job-runner.js';
import supabaseAdmin from '../config/supabase.js';
import { isCloud, getPlan, isSubscriptionActive } from '../config/plans.js';
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
      .select('id, organization_id')
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

    const job = await createJob({
      type: 'tracking',
      brandId,
      data: { brandId, promptId: promptId || null, immediate: true },
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
    console.error('[tracking] Check error:', error.message);
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
      .select('id, organization_id')
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

    let newPromptIds;

    if (Array.isArray(clientPromptIds) && clientPromptIds.length > 0) {
      // Client sent specific prompt IDs — validate they belong to this brand
      const { data: promptSets } = await supabaseAdmin
        .from('prompt_sets')
        .select('id')
        .eq('brand_id', brandId);

      if (!promptSets || promptSets.length === 0) {
        return res.json({ success: true, newCount: 0, message: 'No prompt sets found' });
      }

      const setIds = promptSets.map((s) => s.id);
      const { data: validPrompts } = await supabaseAdmin
        .from('prompts')
        .select('id')
        .in('prompt_set_id', setIds)
        .in('id', clientPromptIds)
        .eq('is_active', true);

      newPromptIds = (validPrompts || []).map((p) => p.id);
    } else {
      // Auto-detect unanalyzed prompts
      const { data: promptSets } = await supabaseAdmin
        .from('prompt_sets')
        .select('id')
        .eq('brand_id', brandId);

      if (!promptSets || promptSets.length === 0) {
        return res.json({ success: true, newCount: 0, message: 'No prompt sets found' });
      }

      const setIds = promptSets.map((s) => s.id);
      const { data: allPrompts } = await supabaseAdmin
        .from('prompts')
        .select('id')
        .in('prompt_set_id', setIds)
        .eq('is_active', true);

      if (!allPrompts || allPrompts.length === 0) {
        return res.json({ success: true, newCount: 0, message: 'No active prompts' });
      }

      const allPromptIds = allPrompts.map((p) => p.id);

      const { data: existingResults } = await supabaseAdmin
        .from('prompt_results')
        .select('prompt_id')
        .eq('brand_id', brandId)
        .in('prompt_id', allPromptIds);

      const analyzedIds = new Set((existingResults || []).map((r) => r.prompt_id));
      newPromptIds = allPromptIds.filter((id) => !analyzedIds.has(id));
    }

    if (newPromptIds.length === 0) {
      return res.json({ success: true, newCount: 0, message: 'All prompts already analyzed' });
    }

    // --- Cloud-mode subscription gate + rate limiting ---
    if (isCloud()) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('plan, subscription_status')
        .eq('id', brand.organization_id)
        .single();

      // Block tracking outright when the org's Stripe subscription isn't
      // active or trialing. Previously this fell back to starter limits,
      // which let unsubscribed signups run jobs silently.
      if (!isSubscriptionActive(org?.subscription_status)) {
        return res.status(402).json({
          message:
            'An active subscription or free trial is required to run tracking. Please choose a plan to continue.',
        });
      }

      const plan = getPlan(org.plan);

      const { maxDailyOnDemand, onDemandCooldownMinutes } = plan.limits;

      // Check daily on-demand limit
      if (maxDailyOnDemand !== -1) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { count: todayCount } = await supabaseAdmin
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brandId)
          .eq('type', 'tracking')
          .gte('created_at', todayStart.toISOString())
          .contains('data', { onDemand: true });

        if ((todayCount || 0) >= maxDailyOnDemand) {
          return res.status(429).json({
            success: false,
            message: `Daily on-demand analysis limit reached (${maxDailyOnDemand}/day). Next analyses will run with the daily scheduled job.`,
            limit: maxDailyOnDemand,
          });
        }
      }

      // Check cooldown
      if (onDemandCooldownMinutes > 0) {
        const cooldownCutoff = new Date(
          Date.now() - onDemandCooldownMinutes * 60 * 1000,
        ).toISOString();

        const { data: recentJobs } = await supabaseAdmin
          .from('jobs')
          .select('created_at')
          .eq('brand_id', brandId)
          .eq('type', 'tracking')
          .contains('data', { onDemand: true })
          .gte('created_at', cooldownCutoff)
          .limit(1);

        if (recentJobs && recentJobs.length > 0) {
          const nextAvailable = new Date(
            new Date(recentJobs[0].created_at).getTime() + onDemandCooldownMinutes * 60 * 1000,
          );
          const minutesLeft = Math.ceil((nextAvailable.getTime() - Date.now()) / 60_000);
          return res.status(429).json({
            success: false,
            message: `Please wait ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} before running another analysis.`,
            retryAfterMinutes: minutesLeft,
          });
        }
      }
    }

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
    console.error('[tracking] analyze-new error:', error.message);
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
    console.error('[tracking] unanalyzed error:', error.message);
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
    console.error('[tracking] Results error:', error.message);
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
    console.error('[tracking] Status error:', error.message);
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
    console.error('[tracking] Job status error:', error.message);
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
    console.error('[tracking] Job cancel error:', error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

export default router;
