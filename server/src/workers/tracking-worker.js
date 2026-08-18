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
import { updateTargetUrlStats } from '../lib/target-url-stats.js';
import { persistCitationRows } from '../lib/citation-rows.js';
import logger from '../lib/logger.js';

function resolveModelPlatform(model) {
  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gemini-')) return 'gemini';
  return 'chatgpt';
}

/**
 * Platforms Cloro cannot currently deliver, dropped before anything is
 * submitted.
 *
 * Grok started answering every task with a 500 on 2026-08-18. Leaving it in
 * the run would submit a paid task per prompt per region, hold the drain open
 * waiting for results that never arrive, and record nothing — so the platform
 * is removed up front rather than failing task by task.
 *
 * Deliberately a run-time filter and nothing else. Dropping Grok from the
 * engine picker would also drop it from `ALL_SCRAPERS`, which
 * `filterByPlan` and `alignPromptsToPlanForOrg` use as the allow-set when
 * writing prompts — so every prompt edit and every plan change would quietly
 * strip the stored id, and restoring Grok would need a data repair rather
 * than a revert. Empty this list when Cloro reports Grok healthy again and
 * every prompt that still lists it resumes on the next run.
 */
export const UNAVAILABLE_PLATFORMS = ['grok-web'];

/**
 * The platforms a prompt should actually be run against.
 *
 * Prompts keep whatever platform ids they were saved with, so the stored array
 * cannot be trusted at run time: a brand may have turned Shopping off since,
 * and a platform may be down. Both are filtered here rather than at the picker,
 * because every id that survives becomes a paid Cloro submission.
 */
export function runnablePlatforms(platforms, { shoppingEnabled } = {}) {
  return (platforms ?? []).filter(
    (platform) =>
      !UNAVAILABLE_PLATFORMS.includes(platform) &&
      (shoppingEnabled || platform !== 'chatgpt-shopping'),
  );
}

/**
 * PostgREST silently caps an un-paginated select at 1000 rows, so reading a
 * brand's pending tasks in one request under-reports any run that submitted
 * more than that (#714). Page through instead.
 *
 * Exported for the test that pins the paging behaviour; `fetchPage(offset)`
 * resolves to `{ data, error }` exactly as a PostgREST range query does.
 */
export const PENDING_PAGE_SIZE = 1000;

export async function fetchAllPendingRows(fetchPage, pageSize = PENDING_PAGE_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset);
    // A partial read is worse than no read: it looks like progress that never
    // happened. Surface the error and let the caller retry the whole poll.
    if (error) return { rows: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
  }
}

/**
 * Which drain time budget, if any, has run out (#702).
 *
 * Two budgets rather than one cap measured from submission. Before anything
 * has come back there is nothing to reason about — the stall and ghost exits
 * both compare successive pending counts — so that phase gets its own, longer
 * allowance. Once delivery starts, the tail is measured from the first result,
 * so a slow queue start no longer consumes the time the tail needs.
 *
 * Returns 'no_first_result', 'tail_deadline', or null while within budget.
 */
export function drainBudgetExceeded({
  now,
  drainStartedAt,
  firstResultAt,
  firstResultWaitMs,
  drainTailMs,
}) {
  if (firstResultAt === null || firstResultAt === undefined) {
    return now - drainStartedAt >= firstResultWaitMs ? 'no_first_result' : null;
  }
  return now - firstResultAt >= drainTailMs ? 'tail_deadline' : null;
}

/**
 * True when every still-pending task was submitted longer ago than `maxAgeMs`.
 *
 * Such tasks can no longer be in flight: Cloro accepted them and never called
 * back (google-aio does this whenever a query has no AI Overview). Combined
 * with "no new result for a while", this is what separates a ghost tail from
 * a normal quiet gap mid-burst, where fresh tasks are still outstanding.
 *
 * Deliberately false for an empty list — no pending tasks is a completed
 * drain, handled by the caller before this is consulted.
 */
export function allTasksAreStale(rows, maxAgeMs, now = Date.now()) {
  if (!rows || rows.length === 0) return false;
  const cutoff = now - maxAgeMs;
  return rows.every((r) => r.submitted_at && new Date(r.submitted_at).getTime() < cutoff);
}

/**
 * Core logic: fetch prompts, run them through specified models, store results.
 * @param {{ brandId: string, promptId?: string, promptIds?: string[], source?: string, job?: { progress: function, signal?: AbortSignal } }} opts
 */
export async function processTrackingJob({ brandId, promptId, promptIds, source, job }) {
  // 1. Fetch brand info with domains
  const { data: brand, error: brandErr } = await supabaseAdmin
    .from('brands')
    .select('id, name, organization_id, shopping_mode_enabled, state')
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

  // Tracking-run ledger (00044): FULL runs stamp a row so the insights 24h
  // view can anchor to the last COMPLETED run instead of a wall-clock window
  // that empties and refills every morning. Single/subset-prompt runs must
  // NOT stamp — a completed single-prompt "run" would swing the dashboard
  // window onto one prompt's worth of data.
  //
  // By the time this function returns, this run's scraper results are already
  // inserted (webhook mode drains its own submitted task_ids above; polling
  // mode is inline), so completion is stamped at the end of this function —
  // no webhook-side bookkeeping needed. The stall/deadline caps in the drain
  // loop bound how long a stuck Cloro queue can delay the stamp.
  const isFullRun = !promptId && (!promptIds || promptIds.length === 0);
  let trackingRunId = null;
  let trackingRunStartedAt = null;
  if (isFullRun) {
    // A run that died mid-flight (crash, abort) leaves an uncompleted row;
    // clear those so at most one in-progress row exists per brand.
    await supabaseAdmin
      .from('tracking_runs')
      .delete()
      .eq('brand_id', brandId)
      .is('completed_at', null);

    const { data: runRow, error: runErr } = await supabaseAdmin
      .from('tracking_runs')
      .insert({ brand_id: brandId, source: source || 'manual' })
      .select('id, started_at')
      .single();
    if (runErr) {
      // Ledger failure must never block tracking itself.
      logger.warn({ err: runErr, brandId }, 'failed to create tracking_runs row');
    } else {
      trackingRunId = runRow.id;
      trackingRunStartedAt = runRow.started_at;
    }
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

  const allowedPlatformsFor = (prompt) =>
    runnablePlatforms(prompt.platforms, { shoppingEnabled: brand.shopping_mode_enabled });

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
    // `created_at` comes back from the insert rather than being stamped here:
    // the citation rows copy it, and a value computed in app code would drift
    // from the column default by the round trip.
    const { data: inserted, error } = await supabaseAdmin
      .from('prompt_results')
      .insert(row)
      .select('id, created_at')
      .single();
    if (error) {
      logger.error({ err: error, brandId }, 'failed to insert tracking result');
      throw error;
    }
    insertedCount++;
    // Best-effort: mark target URLs cited by this answer (00032).
    await updateTargetUrlStats(row.prompt_id, row.citations, new Date().toISOString());
    // Best-effort: expand the citation array into rows (#732). The jsonb
    // column still holds the same data, so anything missed here is recoverable
    // with the backfill rather than lost.
    await persistCitationRows({
      promptResultId: inserted.id,
      brandId: row.brand_id,
      createdAt: inserted.created_at,
      citations: row.citations,
    });
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
        submitScraperTask(t.prompt.text, t.scraperId, t.region, {
          webhookUrl,
          state: brand.state,
        }).then((res) => ({
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
        const drainPollMs = 15_000;
        // Two separate budgets, because "nothing has come back yet" and "the
        // tail is taking a while" are different situations (#702).
        //
        // A single 60-minute cap measured from submission discarded healthy
        // runs: on the largest brand the first callback landed 62-65 minutes
        // after submission three nights running, so the worker gave up two to
        // five minutes before the delivery it was waiting for. The run then
        // produced zero results at stamp time, the ledger row was deleted, and
        // the dashboard and pulse stayed anchored to the previous day even
        // though ~1800 results landed minutes later.
        //
        // Before the first result there is nothing to measure: the stall and
        // ghost exits below both reason about *changes* in the pending set, so
        // they are meaningless until at least one task has come back. That
        // phase gets its own generous budget.
        const firstResultWaitMs = (Number(process.env.CLORO_FIRST_RESULT_WAIT_MIN) || 90) * 60_000;
        // Once delivery has started, this bounds the tail. Measured from the
        // first result rather than from submission, so a slow queue start no
        // longer eats the time the tail needs.
        const drainTailMs = (Number(process.env.CLORO_DRAIN_TAIL_MIN) || 60) * 60_000;
        // Give up early if delivery stalls — no new result for this many
        // consecutive polls. Cloro delivers in bursts with quiet gaps: a real
        // run went silent for 10+ minutes after the first ~600 results and
        // then delivered the remaining ~1000, so the old ~10-min limit cut a
        // healthy run in half. ~25 min tolerates those gaps while the tail
        // budget above stays the hard cap on a queue that dies mid-delivery.
        // Only counted once the first result has arrived.
        const stallPollLimit = Number(process.env.CLORO_STALL_POLL_LIMIT) || 100;
        // Ghost tasks — accepted by Cloro, never called back (google-aio does
        // this whenever a query has no AI Overview) — used to burn the whole
        // stall window on every run. Once delivery has gone quiet AND every
        // remaining task is old enough that it can no longer be in flight,
        // there is nothing left to wait for. Both conditions are required: a
        // quiet gap alone is normal mid-burst, and old tasks alone are fine as
        // long as results are still landing.
        const ghostStallPolls = Number(process.env.CLORO_GHOST_STALL_POLLS) || 60;
        // How old a still-pending task has to be before it counts as a ghost.
        // Configurable because the safe value tracks Cloro's delivery latency,
        // which moves: one brand's first result has arrived 34 minutes after
        // submission, and another's at 29.7 — seconds under this threshold.
        // Raise it if healthy runs start exiting as 'ghosts'.
        const ghostTaskAgeMs = (Number(process.env.CLORO_GHOST_TASK_AGE_MIN) || 30) * 60_000;

        let lastPending = expectedSubmitted;
        let stalledPolls = 0;
        const drainStartedAt = Date.now();
        const drainStartedIso = new Date(drainStartedAt).toISOString();
        let firstResultAt = null;
        let exitReason = 'drained';

        for (;;) {
          // Budget first, so it also bounds a poll that keeps failing — the
          // retry path below skips the rest of the iteration.
          const budgetExit = drainBudgetExceeded({
            now: Date.now(),
            drainStartedAt,
            firstResultAt,
            firstResultWaitMs,
            drainTailMs,
          });
          if (budgetExit) {
            exitReason = budgetExit;
            break;
          }

          // Brand-scoped read, intersected in memory with our own task_ids —
          // avoids a giant `.in(...)` URL. Paged, because PostgREST caps an
          // un-paginated select at 1000 rows: a run that submitted more than
          // that saw a pending count frozen at 1000, which read as "1130 tasks
          // already finished" on the first poll and as "nothing is moving" on
          // every poll after it (#714).
          const { rows, error: drainErr } = await fetchAllPendingRows((offset) =>
            supabaseAdmin
              .from('cloro_pending_tasks')
              .select('task_id, submitted_at')
              .eq('brand_id', brandId)
              .range(offset, offset + PENDING_PAGE_SIZE - 1),
          );

          // A transient read failure must NOT be read as "0 pending" — that would
          // break the loop early and report the run as finished while tasks are
          // still in flight. Skip this tick and retry on the next poll.
          if (drainErr) {
            logger.warn({ err: drainErr, brandId }, 'pending-task poll failed, retrying');
            await new Promise((r) => setTimeout(r, drainPollMs));
            continue;
          }

          const ourRows = (rows || []).filter((r) => submittedTaskIds.has(r.task_id));
          const pending = ourRows.length;
          const processed = expectedSubmitted - pending;
          const allPendingAreOld = allTasksAreStale(ourRows, ghostTaskAgeMs);

          // "Delivery started" has to mean a result actually landed, not just
          // that a pending row went away. The callback handler also deletes
          // rows for FAILED tasks, for a COMPLETED task with no response body,
          // and when the brand lookup fails — none of which produce a result.
          // A shrinking pending set is therefore not proof that anything
          // arrived, and treating it as proof starts the stall clock against a
          // run that has received nothing (#714).
          if (processed > 0 && firstResultAt === null) {
            const { data: firstRows, error: firstErr } = await supabaseAdmin
              .from('prompt_results')
              .select('id')
              .eq('brand_id', brandId)
              .gte('created_at', drainStartedIso)
              .limit(1);
            if (!firstErr && (firstRows ?? []).length > 0) {
              firstResultAt = Date.now();
              logger.info(
                { brandId, waitedMs: firstResultAt - drainStartedAt, expected: expectedSubmitted },
                'cloro delivery started',
              );
            }
          }

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

          // Stall and ghost detection reason about changes in the pending set,
          // so they only mean anything once something has come back.
          if (firstResultAt === null) {
            await new Promise((r) => setTimeout(r, drainPollMs));
            continue;
          }

          if (pending < lastPending) {
            lastPending = pending;
            stalledPolls = 0;
          } else if (allPendingAreOld && stalledPolls + 1 >= ghostStallPolls) {
            stalledPolls += 1;
            exitReason = 'ghosts';
            break;
          } else if (++stalledPolls >= stallPollLimit) {
            exitReason = 'stalled';
            break;
          }

          await new Promise((r) => setTimeout(r, drainPollMs));
        }

        // Always log how the drain ended. Reconstructing this from the database
        // the morning after — which is how #702 was diagnosed — is guesswork,
        // because the timed-out path used to fall out of the loop silently.
        const log = exitReason === 'drained' ? logger.info : logger.warn;
        log.call(
          logger,
          {
            brandId,
            exitReason,
            expected: expectedSubmitted,
            elapsedMs: Date.now() - drainStartedAt,
            firstResultAfterMs: firstResultAt ? firstResultAt - drainStartedAt : null,
          },
          `cloro drain finished (${exitReason})`,
        );
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
              mention_position: metrics.mentionPosition,
              mentioned_entity_count: metrics.mentionedEntityCount,
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
            mention_position: metrics.mentionPosition,
            mentioned_entity_count: metrics.mentionedEntityCount,
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

  // Stamp the ledger row. The run's result count MUST come from the DB, not
  // from `insertedCount`: in webhook mode the scraper results are inserted by
  // the /cloro/callback handler, so the worker's own counter only sees the
  // API-model phase — on scraper-only brands it stays 0 even after a fully
  // successful run, and the first deploy of this ledger deleted every real
  // run's row because of it. Zero results in the DB (every task genuinely
  // failed) still deletes the row: completing it would swing the 24h anchor
  // onto an empty window. On a count error we leave the row uncompleted —
  // the dashboard keeps the previous completed run and the next run clears
  // the dangling row.
  let runStamped = false;

  if (trackingRunId) {
    const { count: runResultCount, error: countErr } = await supabaseAdmin
      .from('prompt_results')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', trackingRunStartedAt);

    // Partial-run guard: a run that produced far fewer results than it
    // planned tasks (Cloro delivered late/never) must not become the 24h
    // anchor — a half-empty window reads as a visibility crash in the
    // dashboard and the pulse mail. The ratio compares against THIS run's
    // own planned task count, never against history, so a brand that
    // legitimately shrinks its prompt set can't wedge the guard. Late
    // results that land after the previous anchor stay visible in the next
    // stamped window — nothing is lost, the anchor just refuses to move
    // onto partial data.
    const MIN_STAMP_RATIO = 0.5;
    const isPartial = totalTasks > 0 && (runResultCount ?? 0) < totalTasks * MIN_STAMP_RATIO;

    if (countErr) {
      logger.error({ err: countErr, brandId, trackingRunId }, 'failed to count run results');
    } else if ((runResultCount ?? 0) > 0 && !isPartial) {
      const { error: stampErr } = await supabaseAdmin
        .from('tracking_runs')
        .update({ completed_at: new Date().toISOString(), result_count: runResultCount })
        .eq('id', trackingRunId);
      if (stampErr) {
        logger.error({ err: stampErr, brandId, trackingRunId }, 'failed to stamp tracking run');
      } else {
        runStamped = true;
        logger.info({ brandId, trackingRunId, runResultCount }, 'tracking run stamped');
      }
    } else if ((runResultCount ?? 0) > 0) {
      logger.warn(
        { brandId, trackingRunId, runResultCount, totalTasks },
        'tracking run partial — below stamp ratio, row removed; window stays on previous run',
      );
      await supabaseAdmin.from('tracking_runs').delete().eq('id', trackingRunId);
    } else {
      logger.warn({ brandId, trackingRunId }, 'tracking run produced no results — row removed');
      await supabaseAdmin.from('tracking_runs').delete().eq('id', trackingRunId);
    }
  }

  // `stamped` gates the Daily Pulse (#702): a run whose ledger row was
  // refused never moved the 24h anchor, so its pulse would recompute the
  // previous run's window and mail numbers the recipient already has.
  return { resultCount: insertedCount, stamped: runStamped };
}
