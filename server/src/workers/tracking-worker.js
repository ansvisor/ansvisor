/**
 * Tracking job processor.
 * Fetches brand data, runs prompts through AI models / scrapers, stores results.
 */

import { runPrompt, analyzeSentimentAI } from '../lib/ai-tracker.js';
import { submitScraperTask, pollScraperResult } from '../lib/cloro-scraper.js';
import { parseResponse, countBrandMentions } from '../lib/response-parser.js';
import supabaseAdmin from '../config/supabase.js';
import { hasFeature, getPlan, isCloud } from '../config/plans.js';
import { applyPlanOverrides } from '../lib/plan-guard.js';
import { generateContentOpportunities } from '../lib/opportunity-generator.js';
import logger from '../lib/logger.js';

function resolveModelPlatform(model) {
  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gemini-')) return 'gemini';
  return 'chatgpt';
}

/**
 * Core logic: fetch prompts, run them through specified models, store results.
 * @param {{ brandId: string, promptId?: string, promptIds?: string[], job?: { progress: function, signal?: AbortSignal } }} opts
 */
export async function processTrackingJob({ brandId, promptId, promptIds, job }) {
  // 1. Fetch brand info with domains
  const { data: brand, error: brandErr } = await supabaseAdmin
    .from('brands')
    .select('id, name, organization_id, shopping_mode_enabled')
    .eq('id', brandId)
    .single();
  if (brandErr || !brand) throw new Error(`Brand not found: ${brandId}`);

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);

  const brandInfo = {
    brandName: brand.name,
    domains: (domains || []).map((d) => d.domain),
  };

  // 2. Fetch active prompts
  const { data: promptSets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (!promptSets || promptSets.length === 0) {
    logger.info({ brandId }, 'no prompt sets for brand');
    return { resultCount: 0 };
  }

  const setIds = promptSets.map((s) => s.id);

  let promptsQuery = supabaseAdmin
    .from('prompts')
    .select('*')
    .in('prompt_set_id', setIds)
    .eq('is_active', true);

  if (promptId) {
    promptsQuery = promptsQuery.eq('id', promptId);
  } else if (promptIds && promptIds.length > 0) {
    promptsQuery = promptsQuery.in('id', promptIds);
  }

  const { data: prompts, error: promptErr } = await promptsQuery;
  if (promptErr) throw new Error(`Failed to fetch prompts: ${promptErr.message}`);
  if (!prompts || prompts.length === 0) {
    logger.info({ brandId }, 'no active prompts for brand');
    return { resultCount: 0 };
  }

  // 3. Fetch competitors for this brand
  const { data: competitorRows } = await supabaseAdmin
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  const competitors = (competitorRows || []).map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain || '',
  }));

  // 3b. Cloud: API-model tracking is plan-gated (Growth has no Claude;
  // Enterprise is per-customer via organizations.plan_overrides.allowedModels).
  // Prompts can still carry disallowed model ids from an earlier plan, so
  // filter at run time instead of trusting the stored arrays. `null` means
  // every model is allowed (self-host, or a plan without the restriction).
  let allowedModels = null;
  if (isCloud()) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan, plan_overrides')
      .eq('id', brand.organization_id)
      .single();
    const plan = applyPlanOverrides(getPlan(org?.plan), org);
    allowedModels = plan.limits.allowedModels ?? null;
    if (allowedModels) {
      logger.info({ brandId, allowedModels }, 'api-model tracking plan-gated for this org');
    }
  }
  const allowedModelsFor = (prompt) => {
    const models = prompt.models && prompt.models.length > 0 ? prompt.models : [];
    return allowedModels ? models.filter((m) => allowedModels.includes(m)) : models;
  };

  // Shopping tracking is opt-in per brand: prompts can still carry the
  // chatgpt-shopping platform from before the brand turned Shopping off (or
  // from a picker that offered it regardless of the pref), so filter at run
  // time instead of trusting the stored arrays — each skipped task is a paid
  // Cloro scrape for data the brand can't even see.
  const allowedPlatformsFor = (prompt) => {
    const platforms = prompt.platforms && prompt.platforms.length > 0 ? prompt.platforms : [];
    return brand.shopping_mode_enabled
      ? platforms
      : platforms.filter((p) => p !== 'chatgpt-shopping');
  };

  // 4. Count total tasks: prompt × (models + scrapers) × regions
  let totalTasks = 0;
  for (const prompt of prompts) {
    const mc = allowedModelsFor(prompt).length;
    const sc = allowedPlatformsFor(prompt).length;
    const rc = prompt.regions && prompt.regions.length > 0 ? prompt.regions.length : 1;
    totalTasks += (mc + sc) * rc;
  }

  // 5. Shared counters & helper
  let insertedCount = 0;
  let completedTasks = 0;

  async function insertResult(row) {
    const { error } = await supabaseAdmin.from('prompt_results').insert(row);
    if (error) {
      logger.error({ err: error, brandId }, 'failed to insert tracking result');
      throw error;
    }
    insertedCount++;
  }

  // 6. Phase 1: Collect & run all scraper (platform) tasks first
  const scraperTasks = [];
  for (const prompt of prompts) {
    const scrapersToRun = allowedPlatformsFor(prompt);
    const regionsToRun = prompt.regions && prompt.regions.length > 0 ? prompt.regions : [null];

    for (const scraperId of scrapersToRun) {
      for (const region of regionsToRun) {
        scraperTasks.push({ prompt, scraperId, region });
      }
    }
  }

  const webhookUrl = process.env.CLORO_WEBHOOK_URL;

  if (scraperTasks.length > 0) {
    logger.info(
      { brandId, count: scraperTasks.length, mode: webhookUrl ? 'webhook' : 'polling' },
      'submitting scraper tasks to cloro',
    );

    if (job) {
      job.progress({
        current: completedTasks,
        total: totalTasks,
        promptText: 'Preparing platform scans...',
        model: null,
        platform: 'cloro',
      });
    }

    // Submit all tasks concurrently
    const submissions = await Promise.allSettled(
      scraperTasks.map((t) =>
        submitScraperTask(t.prompt.text, t.scraperId, t.region, { webhookUrl }).then((res) => ({
          ...res,
          meta: t,
        })),
      ),
    );

    const submitted = [];
    for (const sub of submissions) {
      if (sub.status === 'fulfilled') {
        logger.debug(
          { scraperId: sub.value.scraperId, taskId: sub.value.taskId },
          'submitted scraper task',
        );
        submitted.push(sub.value);
      } else {
        const failedTask = scraperTasks[submissions.indexOf(sub)];
        logger.error(
          { err: sub.reason, scraperId: failedTask.scraperId },
          'failed to submit scraper task',
        );
        completedTasks++;
      }
    }

    if (webhookUrl) {
      // Webhook mode: persist (taskId → prompt) mapping; the /cloro/callback
      // endpoint will pick up results asynchronously when Cloro pushes them.
      if (submitted.length > 0) {
        const pendingRows = submitted.map(({ taskId, scraperId, meta }) => ({
          task_id: taskId,
          prompt_id: meta.prompt.id,
          brand_id: brandId,
          scraper_id: scraperId,
          region: meta.region,
        }));

        const { error: pendingErr } = await supabaseAdmin
          .from('cloro_pending_tasks')
          .insert(pendingRows);

        if (pendingErr) {
          logger.error(
            { err: pendingErr, brandId },
            'failed to record pending cloro tasks — webhook results will be dropped',
          );
        } else {
          logger.info(
            { brandId, count: submitted.length },
            'pending cloro tasks recorded; webhook will deliver results',
          );
        }
      }

      // Wait for the webhook handler to drain THIS job's pending tasks. The
      // worker stays alive (cheap DB poll) so the job's `active` status drives
      // the UI loading banner until results actually arrive.
      //
      // We count only the task_ids THIS run submitted — not every pending row
      // for the brand. A brand-wide count is poisoned by orphan rows from tasks
      // Cloro never delivered a webhook for (and by concurrent runs), so it
      // never reaches zero: the drain loop runs to the deadline and the progress
      // bar freezes partway even though results keep landing. Counting our own
      // task_ids lets the loop finish as soon as this run's results are in.
      const submittedTaskIds = new Set(submitted.map((s) => s.taskId));
      const expectedSubmitted = submittedTaskIds.size;

      if (expectedSubmitted > 0) {
        // Hard cap so a stuck Cloro queue can't keep a worker alive forever.
        const drainDeadline = Date.now() + 60 * 60 * 1000;
        const drainPollMs = 15_000;
        // Give up early if delivery stalls — no new result for this many
        // consecutive polls (~10 min) means the rest were almost certainly
        // dropped, so don't hold the bar (and a concurrency slot) for an hour.
        const stallPollLimit = 40;

        let lastPending = expectedSubmitted;
        let stalledPolls = 0;

        while (Date.now() < drainDeadline) {
          // Brand-scoped read (a handful of rows at most), intersected in memory
          // with our own task_ids — avoids a giant `.in(...)` URL.
          const { data: rows, error: drainErr } = await supabaseAdmin
            .from('cloro_pending_tasks')
            .select('task_id')
            .eq('brand_id', brandId);

          // A transient read failure must NOT be read as "0 pending" — that would
          // break the loop early and report the run as finished while tasks are
          // still in flight. Skip this tick and retry on the next poll.
          if (drainErr) {
            logger.warn({ err: drainErr, brandId }, 'pending-task poll failed, retrying');
            await new Promise((r) => setTimeout(r, drainPollMs));
            continue;
          }

          const pending = (rows || []).filter((r) => submittedTaskIds.has(r.task_id)).length;
          const processed = expectedSubmitted - pending;

          if (job) {
            job.progress({
              current: completedTasks + processed,
              total: totalTasks,
              promptText:
                pending > 0
                  ? `Receiving platform results — ${pending} task(s) still processing...`
                  : 'All platform results received',
              model: null,
              platform: 'cloro',
            });
          }

          if (pending === 0) break;

          if (pending < lastPending) {
            lastPending = pending;
            stalledPolls = 0;
          } else if (++stalledPolls >= stallPollLimit) {
            logger.warn(
              { brandId, pending, expected: expectedSubmitted },
              'cloro delivery stalled — some tasks never returned; continuing',
            );
            break;
          }

          await new Promise((r) => setTimeout(r, drainPollMs));
        }
      }

      completedTasks += expectedSubmitted;
    } else {
      logger.info(
        { submitted: submitted.length, total: scraperTasks.length },
        'tasks submitted, polling for results',
      );

      // Polling fallback: wait for each task inline (legacy behavior)
      await Promise.allSettled(
        submitted.map(async ({ taskId, scraperId, meta }) => {
          try {
            logger.debug({ taskId, scraperId }, 'polling scraper task');
            const aiResponse = await pollScraperResult(taskId, scraperId);
            logger.debug({ taskId, scraperId }, 'scraper task completed, inserting result');

            const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
            const sentimentResult =
              mentionCount > 0
                ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName)
                : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };
            const metrics = parseResponse(
              aiResponse,
              brandInfo,
              sentimentResult.sentiment,
              competitors,
            );

            await insertResult({
              prompt_id: meta.prompt.id,
              brand_id: brandId,
              platform: meta.scraperId,
              response: aiResponse.text,
              citations: aiResponse.citations,
              mention_count: metrics.mentionCount,
              citation_count: metrics.citationCount,
              sentiment: metrics.sentiment,
              visibility_score: metrics.visibilityScore,
              model_used: aiResponse.model,
              region: meta.region,
              competitor_mentions: metrics.competitorMentions,
              search_queries: Array.isArray(aiResponse.search_queries)
                ? aiResponse.search_queries
                : [],
            });

            logger.debug({ taskId, scraperId }, 'scraper task result saved');
          } catch (err) {
            logger.error({ err, taskId, scraperId }, 'scraper task failed');
          }

          completedTasks++;
          if (job) {
            job.progress({
              current: completedTasks,
              total: totalTasks,
              promptText: meta.prompt.text.slice(0, 80),
              model: scraperId,
              platform: 'cloro',
            });
          }
        }),
      );
    }
  }

  // 7. Phase 2: Run AI model tasks concurrently
  const modelTasks = [];
  for (const prompt of prompts) {
    const modelsToRun = allowedModelsFor(prompt);
    const regionsToRun = prompt.regions && prompt.regions.length > 0 ? prompt.regions : [null];

    for (const modelName of modelsToRun) {
      for (const region of regionsToRun) {
        modelTasks.push({ prompt, modelName, region });
      }
    }
  }

  if (modelTasks.length > 0) {
    logger.info({ count: modelTasks.length }, 'running ai model tasks concurrently');

    await Promise.allSettled(
      modelTasks.map(async ({ prompt, modelName, region }) => {
        if (job) {
          job.progress({
            current: completedTasks,
            total: totalTasks,
            promptText: prompt.text.slice(0, 80),
            model: modelName,
            region,
            platform: resolveModelPlatform(modelName),
          });
        }

        try {
          const aiResponse = await runPrompt(prompt.text, modelName, region);

          const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
          const sentimentResult =
            mentionCount > 0
              ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName)
              : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };
          const metrics = parseResponse(
            aiResponse,
            brandInfo,
            sentimentResult.sentiment,
            competitors,
          );

          await insertResult({
            prompt_id: prompt.id,
            brand_id: brandId,
            platform: resolveModelPlatform(modelName),
            response: aiResponse.text,
            citations: aiResponse.citations,
            mention_count: metrics.mentionCount,
            citation_count: metrics.citationCount,
            sentiment: metrics.sentiment,
            visibility_score: metrics.visibilityScore,
            model_used: aiResponse.model,
            region,
            competitor_mentions: metrics.competitorMentions,
          });
        } catch (err) {
          logger.error({ err, model: modelName, region }, 'ai model task failed');
        }

        completedTasks++;
        if (job) {
          job.progress({
            current: completedTasks,
            total: totalTasks,
            promptText: prompt.text.slice(0, 80),
            model: modelName,
            platform: resolveModelPlatform(modelName),
          });
        }
      }),
    );
  }

  logger.info({ brandId, resultCount: insertedCount }, 'tracking results stored');

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('organization_id', brand.organization_id)
      .limit(1)
      .single();

    if (profile) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('plan')
        .eq('id', brand.organization_id)
        .single();

      const plan = getPlan(org?.plan);
      if (hasFeature(plan, 'content_optimization')) {
        generateContentOpportunities(brandId).catch((err) => {
          logger.error({ err, brandId }, 'auto opportunity generation failed');
        });
      }
    }
  } catch (err) {
    logger.error({ err, brandId }, 'failed to check opportunity generation eligibility');
  }

  return { resultCount: insertedCount };
}
