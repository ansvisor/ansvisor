/**
 * Tracking job processor.
 * Fetches brand data, runs prompts through AI models / scrapers, stores results.
 */

import { runPrompt, analyzeSentimentAI } from '../lib/ai-tracker.js';
import { submitScraperTask, pollScraperResult } from '../lib/cloro-scraper.js';
import { parseResponse, countBrandMentions } from '../lib/response-parser.js';
import supabaseAdmin from '../config/supabase.js';
import { hasFeature, getPlan } from '../config/plans.js';
import { generateContentOpportunities } from '../lib/opportunity-generator.js';

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
    .select('id, name, organization_id')
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
    console.log(`[tracking] No prompt sets for brand ${brandId}`);
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
    console.log(`[tracking] No active prompts for brand ${brandId}`);
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

  // 4. Count total tasks: prompt × (models + scrapers) × regions
  let totalTasks = 0;
  for (const prompt of prompts) {
    const mc = prompt.models && prompt.models.length > 0 ? prompt.models.length : 0;
    const sc = prompt.platforms && prompt.platforms.length > 0 ? prompt.platforms.length : 0;
    const rc = prompt.regions && prompt.regions.length > 0 ? prompt.regions.length : 1;
    totalTasks += (mc + sc) * rc;
  }

  // 5. Shared counters & helper
  let insertedCount = 0;
  let completedTasks = 0;

  async function insertResult(row) {
    const { error } = await supabaseAdmin.from('prompt_results').insert(row);
    if (error) {
      console.error('[tracking] Failed to insert result:', error.message);
      throw error;
    }
    insertedCount++;
  }

  // 6. Phase 1: Collect & run all scraper (platform) tasks first
  const scraperTasks = [];
  for (const prompt of prompts) {
    const scrapersToRun = prompt.platforms && prompt.platforms.length > 0
      ? prompt.platforms
      : [];
    const regionsToRun = prompt.regions && prompt.regions.length > 0
      ? prompt.regions
      : [null];

    for (const scraperId of scrapersToRun) {
      for (const region of regionsToRun) {
        scraperTasks.push({ prompt, scraperId, region });
      }
    }
  }

  const webhookUrl = process.env.CLORO_WEBHOOK_URL;

  if (scraperTasks.length > 0) {
    console.log(
      `[tracking] Submitting ${scraperTasks.length} scraper tasks to Cloro (mode=${webhookUrl ? 'webhook' : 'polling'})...`,
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
        submitScraperTask(t.prompt.text, t.scraperId, t.region, { webhookUrl })
          .then((res) => ({ ...res, meta: t }))
      ),
    );

    const submitted = [];
    for (const sub of submissions) {
      if (sub.status === 'fulfilled') {
        console.log(`[tracking] Submitted ${sub.value.scraperId} task=${sub.value.taskId} prompt="${sub.value.meta.prompt.text.slice(0, 50)}..."`);
        submitted.push(sub.value);
      } else {
        const failedTask = scraperTasks[submissions.indexOf(sub)];
        console.error(
          `[tracking] Failed to submit scraper "${failedTask.scraperId}" for "${failedTask.prompt.text.slice(0, 50)}...":`,
          sub.reason?.message || sub.reason,
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
          console.error(
            '[tracking] Failed to record pending Cloro tasks — webhook results will be dropped:',
            pendingErr.message,
          );
        } else {
          console.log(
            `[tracking] ${submitted.length} pending tasks recorded. Webhook will deliver results.`,
          );
        }
      }

      // Wait for the webhook handler to drain cloro_pending_tasks for this brand.
      // The worker stays alive (cheap DB poll) so the job's `active` status drives
      // the UI loading banner until results actually arrive. Hard cap at 60 minutes
      // so a stuck Cloro queue doesn't keep workers running indefinitely.
      const drainDeadline = Date.now() + 60 * 60 * 1000;
      const drainPollMs = 15_000;
      const expectedSubmitted = submitted.length;

      while (Date.now() < drainDeadline) {
        const { count: remaining } = await supabaseAdmin
          .from('cloro_pending_tasks')
          .select('*', { count: 'exact', head: true })
          .eq('brand_id', brandId);

        const pending = remaining ?? 0;
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

        await new Promise((r) => setTimeout(r, drainPollMs));
      }

      completedTasks += expectedSubmitted;
    } else {
      console.log(`[tracking] ${submitted.length}/${scraperTasks.length} tasks submitted, polling for results...`);

      // Polling fallback: wait for each task inline (legacy behavior)
      await Promise.allSettled(
        submitted.map(async ({ taskId, scraperId, meta }) => {
          try {
            console.log(`[tracking] Polling task=${taskId} scraper=${scraperId}...`);
            const aiResponse = await pollScraperResult(taskId, scraperId);
            console.log(`[tracking] Task=${taskId} scraper=${scraperId} completed, inserting result...`);

            const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
            const sentimentResult = mentionCount > 0
              ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName)
              : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };
            const metrics = parseResponse(aiResponse, brandInfo, sentimentResult.sentiment, competitors);

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
            });

            console.log(`[tracking] Task=${taskId} scraper=${scraperId} result saved.`);
          } catch (err) {
            console.error(
              `[tracking] Task=${taskId} scraper=${scraperId} failed: ${err.message}`,
            );
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
    const modelsToRun = prompt.models && prompt.models.length > 0
      ? prompt.models
      : [];
    const regionsToRun = prompt.regions && prompt.regions.length > 0
      ? prompt.regions
      : [null];

    for (const modelName of modelsToRun) {
      for (const region of regionsToRun) {
        modelTasks.push({ prompt, modelName, region });
      }
    }
  }

  if (modelTasks.length > 0) {
    console.log(`[tracking] Running ${modelTasks.length} AI model tasks concurrently...`);

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
          const sentimentResult = mentionCount > 0
            ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName)
            : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };
          const metrics = parseResponse(aiResponse, brandInfo, sentimentResult.sentiment, competitors);

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
          console.error(
            `[tracking] Failed prompt "${prompt.text.slice(0, 50)}..." model=${modelName} region=${region}:`,
            err.message,
          );
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

  console.log(`[tracking] Brand ${brandId}: ${insertedCount} results stored`);

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
          console.error(`[tracking] Auto opportunity generation failed for brand ${brandId}:`, err.message);
        });
      }
    }
  } catch (err) {
    console.error('[tracking] Failed to check opportunity generation eligibility:', err.message);
  }

  return { resultCount: insertedCount };
}
