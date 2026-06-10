import { Router } from 'express';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  requireFeature,
  enforceBriefQuota,
  getBriefQuotaStatus,
  getOrgIdForUser,
  PlanLimitError,
} from '../lib/plan-guard.js';
import { createJob, getJob } from '../lib/job-manager.js';
import { runContentJob } from '../lib/job-runner.js';
import { resolveModel } from '../lib/ai-provider.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

function mapOpportunityRow(row) {
  return {
    id: row.id,
    brandId: row.brand_id,
    promptId: row.prompt_id,
    title: row.title,
    description: row.description,
    type: row.type,
    impact: row.impact,
    opportunityScore: parseFloat(row.opportunity_score),
    status: row.status,
    sourceData: row.source_data || {},
    brief: row.brief || null,
    webhookSentAt: row.webhook_sent_at,
    webhookResponse: row.webhook_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * POST /api/content/generate
 * Enqueues a content opportunity generation job. Returns { jobId } immediately.
 */
router.post('/generate', requireFeature('content_optimization'), async (req, res) => {
  try {
    const { brandId, model } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id, organization_id')
      .eq('id', brandId)
      .single();

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', req.user.id)
      .single();

    if (!profile || profile.organization_id !== brand.organization_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const job = await createJob({
      type: 'content',
      brandId,
      data: { brandId, model: model || null },
      maxAttempts: 2,
    });

    const io = req.app.get('io');
    runContentJob(job.id, io);

    return res.json({
      success: true,
      jobId: job.id,
      message: 'Content generation job enqueued',
    });
  } catch (error) {
    console.error('[content] Enqueue error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/content/job/:jobId
 * Returns job state and progress for content generation.
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) {
      return res.json({ success: true, status: 'not_found' });
    }

    const progress = job.progress || {};

    return res.json({
      success: true,
      status: job.status,
      progress: progress && typeof progress === 'object' && progress.phase ? progress : null,
      result: job.status === 'completed' ? job.result : null,
      failedReason: job.status === 'failed' ? job.failed_reason : null,
    });
  } catch (error) {
    console.error('[content] Job status error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/content/brand/:brandId
 * List opportunities for a brand with optional filters.
 */
router.get('/brand/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;
    const { status, impact, type, limit = 50, offset = 0, sort = 'score' } = req.query;

    let query = supabaseAdmin
      .from('content_opportunities')
      .select('*', { count: 'exact' })
      .eq('brand_id', brandId);

    if (status) query = query.eq('status', status);
    if (impact) query = query.eq('impact', impact);
    if (type) query = query.eq('type', type);

    if (sort === 'score') {
      query = query.order('opportunity_score', { ascending: false });
    } else if (sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(error.message);

    return res.json({
      opportunities: (data || []).map(mapOpportunityRow),
      total: count || 0,
    });
  } catch (error) {
    console.error('List opportunities error:', error);
    return res.status(500).json({
      error: 'Failed to list opportunities',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/bulk/status
 * Update the status of multiple opportunities at once.
 */
router.post('/bulk/status', async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const validStatuses = ['new', 'sent', 'in_progress', 'done', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');

    if (error) throw new Error(error.message);

    return res.json({ updated: data?.length || 0 });
  } catch (error) {
    console.error('Bulk status update error:', error);
    return res.status(500).json({
      error: 'Failed to bulk update status',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/bulk/send-webhook
 * Send multiple opportunities to webhook.
 */
router.post('/bulk/send-webhook', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const { data: opportunities, error: oppErr } = await supabaseAdmin
      .from('content_opportunities')
      .select('*')
      .in('id', ids);

    if (oppErr) throw new Error(oppErr.message);
    if (!opportunities?.length) {
      return res.status(404).json({ error: 'No opportunities found' });
    }

    const brandId = opportunities[0].brand_id;

    const { data: webhookConfig } = await supabaseAdmin
      .from('webhook_configs')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!webhookConfig) {
      return res
        .status(400)
        .json({ error: 'No active webhook configured for this brand. Set up a webhook first.' });
    }

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('name, industry')
      .eq('id', brandId)
      .single();

    const { data: domains } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .eq('is_primary', true)
      .limit(1);

    const serverUrl =
      process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
    const headers = { 'Content-Type': 'application/json' };
    if (webhookConfig.webhook_secret) {
      headers['X-Webhook-Secret'] = webhookConfig.webhook_secret;
    }

    let sent = 0;
    let failed = 0;

    for (const opportunity of opportunities) {
      try {
        let prompt = null;
        if (opportunity.prompt_id) {
          const { data: p } = await supabaseAdmin
            .from('prompts')
            .select('text, category')
            .eq('id', opportunity.prompt_id)
            .single();
          prompt = p;
        }

        const payload = {
          event: 'opportunity.sent',
          opportunity: {
            id: opportunity.id,
            title: opportunity.title,
            description: opportunity.description,
            type: opportunity.type,
            impact: opportunity.impact,
            opportunity_score: parseFloat(opportunity.opportunity_score),
          },
          prompt: prompt ? { text: prompt.text, category: prompt.category } : null,
          data: opportunity.source_data || {},
          brief: opportunity.brief || null,
          brand: {
            name: brand?.name || '',
            domain: domains?.[0]?.domain || '',
            industry: brand?.industry || '',
          },
          callback_url: `${serverUrl}/api/content/${opportunity.id}/status`,
        };

        const webhookRes = await fetch(webhookConfig.webhook_url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });

        const responseBody = await webhookRes.text().catch(() => '');

        await supabaseAdmin
          .from('content_opportunities')
          .update({
            status: 'sent',
            webhook_sent_at: new Date().toISOString(),
            webhook_response: {
              status: webhookRes.status,
              body: responseBody.slice(0, 1000),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', opportunity.id);

        sent++;
      } catch {
        failed++;
      }
    }

    return res.json({ sent, failed });
  } catch (error) {
    console.error('Bulk send webhook error:', error);
    return res.status(500).json({
      error: 'Failed to bulk send webhooks',
      details: error.message,
    });
  }
});

/**
 * PATCH /api/content/:id/status
 * Update the status of an opportunity.
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['new', 'sent', 'in_progress', 'done', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Opportunity not found' });

    return res.json(mapOpportunityRow(data));
  } catch (error) {
    console.error('Update opportunity status error:', error);
    return res.status(500).json({
      error: 'Failed to update status',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/:id/send-webhook
 * Send an opportunity to the configured webhook endpoint.
 */
router.post('/:id/send-webhook', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: opportunity, error: oppErr } = await supabaseAdmin
      .from('content_opportunities')
      .select('*')
      .eq('id', id)
      .single();

    if (oppErr || !opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const { data: webhookConfig } = await supabaseAdmin
      .from('webhook_configs')
      .select('*')
      .eq('brand_id', opportunity.brand_id)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!webhookConfig) {
      return res
        .status(400)
        .json({ error: 'No active webhook configured for this brand. Set up a webhook first.' });
    }

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('name, industry')
      .eq('id', opportunity.brand_id)
      .single();

    const { data: domains } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', opportunity.brand_id)
      .eq('is_primary', true)
      .limit(1);

    let prompt = null;
    if (opportunity.prompt_id) {
      const { data: p } = await supabaseAdmin
        .from('prompts')
        .select('text, category')
        .eq('id', opportunity.prompt_id)
        .single();
      prompt = p;
    }

    const serverUrl =
      process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;

    const payload = {
      event: 'opportunity.sent',
      opportunity: {
        id: opportunity.id,
        title: opportunity.title,
        description: opportunity.description,
        type: opportunity.type,
        impact: opportunity.impact,
        opportunity_score: parseFloat(opportunity.opportunity_score),
      },
      prompt: prompt ? { text: prompt.text, category: prompt.category } : null,
      data: opportunity.source_data || {},
      brief: opportunity.brief || null,
      brand: {
        name: brand?.name || '',
        domain: domains?.[0]?.domain || '',
        industry: brand?.industry || '',
      },
      callback_url: `${serverUrl}/api/content/${opportunity.id}/status`,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (webhookConfig.webhook_secret) {
      headers['X-Webhook-Secret'] = webhookConfig.webhook_secret;
    }

    const webhookRes = await fetch(webhookConfig.webhook_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const responseBody = await webhookRes.text().catch(() => '');

    await supabaseAdmin
      .from('content_opportunities')
      .update({
        status: 'sent',
        webhook_sent_at: new Date().toISOString(),
        webhook_response: {
          status: webhookRes.status,
          body: responseBody.slice(0, 1000),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return res.json({
      success: true,
      webhookStatus: webhookRes.status,
      opportunityStatus: 'sent',
    });
  } catch (error) {
    console.error('Send webhook error:', error);
    return res.status(500).json({
      error: 'Failed to send webhook',
      details: error.message,
    });
  }
});

/**
 * POST /api/content/webhook-test
 * Test a webhook URL with a dummy payload.
 */
router.post('/webhook-test', async (req, res) => {
  try {
    const { webhookUrl, webhookSecret } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ error: 'webhookUrl is required' });
    }

    const payload = {
      event: 'webhook.test',
      message: 'This is a test webhook from AEO platform.',
      timestamp: new Date().toISOString(),
    };

    const headers = { 'Content-Type': 'application/json' };
    if (webhookSecret) {
      headers['X-Webhook-Secret'] = webhookSecret;
    }

    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    return res.json({
      success: webhookRes.ok,
      status: webhookRes.status,
      statusText: webhookRes.statusText,
    });
  } catch (error) {
    return res.json({
      success: false,
      status: 0,
      error: error.message,
    });
  }
});

const briefSchema = z.object({
  suggestedTitle: z.string(),
  contentType: z.enum([
    'blog-post',
    'comparison-page',
    'landing-page',
    'faq-page',
    'guide',
    'case-study',
  ]),
  targetWordCount: z.number(),
  outline: z
    .array(
      z.object({
        heading: z.string(),
        keyPoints: z.array(z.string()),
      }),
    )
    .min(3)
    .max(8),
  targetKeywords: z.array(z.string()).min(3).max(10),
  competitorInsights: z.string(),
  callToAction: z.string(),
});

const BRIEF_SYSTEM_PROMPT = `You are a senior content strategist specializing in Answer Engine Optimization (AEO). Given a content opportunity with its data (prompt text, visibility scores, competitor gaps, etc.), generate a comprehensive content brief that will help a writer create content optimized for AI-generated answers.

Rules:
- The suggested title must be compelling and SEO-friendly.
- The outline should have 3-8 sections with specific key points per section.
- Target keywords should be relevant to the prompt and opportunity.
- Competitor insights should reference the actual competitors cited and their visibility advantage.
- The call to action should be specific and relevant to the content type.
- Target word count should be appropriate for the content type (e.g. blog post: 1500-3000, guide: 3000-5000).`;

/**
 * Generate (or fetch) an AI brief for a content opportunity.
 *
 * Shared core for both the user-facing dashboard route below and the
 * `/api/internal/content/:id/brief` MCP route in server.js. Keeping one
 * implementation here means MCP and dashboard can't drift in cost or
 * output shape.
 *
 * Behavior:
 *   - opportunity not found → throws Error with `.status = 404`
 *   - opportunity has a brief AND `force` is false → returns the cached
 *     brief with `regenerated: false` (no LLM call, no quota charge)
 *   - quota exhausted → throws PlanLimitError (statusCode 403/402)
 *   - otherwise runs the LLM, records usage, writes the result back,
 *     returns `{ brief, generated_at, regenerated: true }`
 */
export async function generateBriefForOpportunity(opportunityId, { force = false, model } = {}) {
  const { data: opportunity, error: oppErr } = await supabaseAdmin
    .from('content_opportunities')
    .select('*')
    .eq('id', opportunityId)
    .single();

  if (oppErr || !opportunity) {
    const err = new Error('Opportunity not found');
    err.status = 404;
    throw err;
  }

  if (opportunity.brief && !force) {
    return {
      brief: opportunity.brief,
      generated_at: opportunity.updated_at,
      regenerated: false,
    };
  }

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('name, industry, description, organization_id')
    .eq('id', opportunity.brand_id)
    .single();

  // Quota is charged to the opportunity's org, and enforced here in the
  // shared core so the dashboard route and the internal MCP route draw
  // from the same monthly pool. Cached reads above never hit this.
  const orgId = brand?.organization_id || null;
  if (orgId) {
    await enforceBriefQuota(orgId);
  }

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', opportunity.brand_id);

  let promptText = opportunity.source_data?.promptText || '';
  let latestResults = [];

  if (opportunity.prompt_id) {
    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('text, category')
      .eq('id', opportunity.prompt_id)
      .single();

    if (prompt) promptText = prompt.text;

    const { data: results } = await supabaseAdmin
      .from('prompt_results')
      .select(
        'platform, visibility_score, mention_count, citation_count, sentiment, response, competitor_mentions',
      )
      .eq('prompt_id', opportunity.prompt_id)
      .order('created_at', { ascending: false })
      .limit(10);

    latestResults = results || [];
  }

  const { data: competitors } = await supabaseAdmin
    .from('competitors')
    .select('name, domain')
    .eq('brand_id', opportunity.brand_id);

  const sourceData = opportunity.source_data || {};

  const userPrompt = `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
Description: ${brand?.description || 'N/A'}
Domain: ${(domains || []).map((d) => d.domain).join(', ') || 'N/A'}
Competitors: ${(competitors || []).map((c) => `${c.name} (${c.domain})`).join(', ') || 'None'}

Opportunity:
- Title: ${opportunity.title}
- Description: ${opportunity.description}
- Type: ${opportunity.type}
- Impact: ${opportunity.impact}
- Score: ${opportunity.opportunity_score}

Related Prompt: "${promptText}"
Intent: ${sourceData.intent || 'unknown'}
Est. AI Volume: ${sourceData.estAiVolume || 0}/mo
Current Visibility: ${sourceData.visibilityScore || 0}%
Competitor Gap: ${sourceData.competitorGap || 0}%
Keywords: ${(sourceData.keywords || []).join(', ') || 'none'}
Competitors Cited: ${(sourceData.competitorsCited || []).join(', ') || 'none'}

Latest Results Summary:
${latestResults.map((r) => `- ${r.platform}: visibility ${r.visibility_score}%, mentions: ${r.mention_count}, citations: ${r.citation_count}, sentiment: ${r.sentiment}`).join('\n') || 'No results yet'}

Generate a detailed content brief for this opportunity.`;

  const aiModel = resolveModel(model);

  const { object: brief } = await generateObject({
    model: aiModel,
    schema: briefSchema,
    system: BRIEF_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  const generatedAt = new Date().toISOString();

  await supabaseAdmin
    .from('content_opportunities')
    .update({ brief, updated_at: generatedAt })
    .eq('id', opportunityId);

  if (orgId) {
    await supabaseAdmin.from('brief_usage').insert({
      organization_id: orgId,
      opportunity_id: opportunityId,
    });
  }

  return { brief, generated_at: generatedAt, regenerated: true };
}

/**
 * GET /api/content/briefs/quota
 * Current monthly brief-generation quota for the user's org.
 * Returns { used, limit, remaining } — limit -1 means unlimited.
 */
router.get('/briefs/quota', async (req, res) => {
  try {
    const orgId = await getOrgIdForUser(req.user.id);
    if (!orgId) {
      // Self-hosted single-user setups may have no org row; no quota applies.
      return res.json({ used: 0, limit: -1, remaining: -1 });
    }
    const quota = await getBriefQuotaStatus(orgId);
    return res.json(quota);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    console.error('[content] Brief quota status error:', error);
    return res.status(500).json({ error: 'Failed to get brief quota', details: error.message });
  }
});

/**
 * POST /api/content/:id/brief
 * Generate an AI-powered content brief for an opportunity.
 *
 * Dashboard-facing route. Preserves the existing cache-on-existing-brief
 * behavior — to force a re-generate, the MCP route in server.js calls
 * `generateBriefForOpportunity` with `{ force: true }` directly.
 *
 * Enforces the monthly brief quota (via the shared core) and returns the
 * updated quota alongside the brief so the UI can refresh its counter.
 */
router.post('/:id/brief', async (req, res) => {
  try {
    const { id } = req.params;
    const { model } = req.body;

    // Ownership check — the quota is charged to the opportunity's org, so
    // only members of that org may trigger generation.
    const { data: opp } = await supabaseAdmin
      .from('content_opportunities')
      .select('brand_id')
      .eq('id', id)
      .single();

    if (!opp) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('organization_id')
      .eq('id', opp.brand_id)
      .single();

    const userOrgId = await getOrgIdForUser(req.user.id);
    if (!brand || !userOrgId || userOrgId !== brand.organization_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await generateBriefForOpportunity(id, { model });
    const quota = await getBriefQuotaStatus(userOrgId);
    return res.json({ brief: result.brief, quota, regenerated: result.regenerated });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    console.error('[content] Brief generation error:', error);
    return res.status(500).json({
      error: 'Failed to generate brief',
      details: error.message,
    });
  }
});

/**
 * GET /api/content/:id
 * Get a single opportunity by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    return res.json(mapOpportunityRow(data));
  } catch (error) {
    console.error('Get opportunity error:', error);
    return res.status(500).json({
      error: 'Failed to get opportunity',
      details: error.message,
    });
  }
});

export default router;
