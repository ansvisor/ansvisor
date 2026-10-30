/**
 * Chat's model steps on the AI budget (lib/chat-budget.js), for the web's
 * Chat engine (web/src/lib/chat/budget.ts). Server to server: CRON_SECRET
 * auth, as the other internal endpoints; the web passes the workspace it
 * checked the person against.
 *
 * POST /api/internal/chat/budget/reserve
 *   { orgId, runId, stepId?, feature?, model, inputTokens, maxOutputTokens, ownKey? }
 *   → 201 { usageId }: the step's row, its worst case held (on Ansvisor's key).
 *   → 429 ai_limit { trial }: the budget can't cover the step; it doesn't start.
 *   → 402 plan_limit: no active plan. 404 not_found: the run isn't the
 *     workspace's. 403 chat_off: Chat is off for the workspace.
 * POST /api/internal/chat/budget/charge
 *   { orgId, usageId, model, usage: { inputTokens, outputTokens, cacheReadTokens?,
 *     cacheWriteTokens? }, latencyMs? }
 *   → 200: the row holds the step's real cost, its prompt cache's reads and
 *     writes priced at their own rates. 404 when it is gone.
 * POST /api/internal/chat/budget/release { orgId, usageId }
 *   → 200: the hold went (nothing was billed). Safe to repeat.
 * A step a Stop aborted calls neither: its hold stays as its cost.
 *
 * Dollars never leave the server: no answer carries one. Calls with the
 * secret aren't counted by the API's per-IP limiter (isInternalChatBudgetCall
 * in middleware/rate-limiter.js): each step makes two, from the web's few
 * shared addresses.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  CHAT_BUDGET_FEATURES,
  ChatBudgetError,
  chargeChatStep,
  releaseChatStep,
  reserveChatStep,
} from '../lib/chat-budget.js';
import { PlanLimitError } from '../lib/plan-guard.js';

const router = Router();

router.use((req, res, next) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** Token counts as the AI SDK reports them, capped well past any model's window. */
const tokens = z.number().int().min(0).max(10_000_000);
const model = z.string().trim().min(1).max(200);

const reserveSchema = z.strictObject({
  orgId: z.guid(),
  runId: z.guid(),
  stepId: z.guid().nullish(),
  feature: z.enum(CHAT_BUDGET_FEATURES).default('chat'),
  model,
  inputTokens: tokens,
  maxOutputTokens: tokens.min(1),
  ownKey: z.boolean().default(false),
});

const chargeSchema = z.strictObject({
  orgId: z.guid(),
  usageId: z.guid(),
  model,
  usage: z.strictObject({
    inputTokens: tokens.optional(),
    outputTokens: tokens.optional(),
    // Of the input tokens, those read from and written to the prompt cache.
    cacheReadTokens: tokens.optional(),
    cacheWriteTokens: tokens.optional(),
  }),
  // How long the model call took, for staff; an hour at most.
  latencyMs: z.number().int().min(0).max(3_600_000).optional(),
});

const releaseSchema = z.strictObject({ orgId: z.guid(), usageId: z.guid() });

/** The body as `schema` reads it, or null once a 400 is sent. */
function parse(schema, req, res) {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  res.status(400).json({ success: false, error: 'invalid_request', message: 'Invalid request' });
  return null;
}

function fail(err, req, res, what) {
  if (err instanceof ChatBudgetError) {
    return res
      .status(err.statusCode)
      .json({ success: false, error: err.code, message: err.message });
  }
  if (err instanceof PlanLimitError) {
    // 429: the budget is used up (in the free trial, the trial's); 402: no active plan.
    return err.statusCode === 429
      ? res.status(429).json({
          success: false,
          error: 'ai_limit',
          trial: err.trial === true,
          message: err.message,
        })
      : res
          .status(err.statusCode)
          .json({ success: false, error: 'plan_limit', message: err.message });
  }
  req.log.error({ err }, `internal chat budget ${what} error`);
  return res.status(500).json({ success: false, message: 'Internal error' });
}

router.post('/reserve', async (req, res) => {
  const body = parse(reserveSchema, req, res);
  if (!body) return undefined;
  try {
    const usageId = await reserveChatStep(body.orgId, {
      feature: body.feature,
      modelId: body.model,
      inputTokens: body.inputTokens,
      maxOutputTokens: body.maxOutputTokens,
      runId: body.runId,
      stepId: body.stepId ?? null,
      ownKey: body.ownKey,
    });
    return res.status(201).json({ success: true, usageId });
  } catch (err) {
    return fail(err, req, res, 'reserve');
  }
});

router.post('/charge', async (req, res) => {
  const body = parse(chargeSchema, req, res);
  if (!body) return undefined;
  try {
    await chargeChatStep(body.orgId, body.usageId, {
      modelId: body.model,
      usage: body.usage,
      latencyMs: body.latencyMs,
    });
    return res.json({ success: true });
  } catch (err) {
    return fail(err, req, res, 'charge');
  }
});

router.post('/release', async (req, res) => {
  const body = parse(releaseSchema, req, res);
  if (!body) return undefined;
  try {
    await releaseChatStep(body.orgId, body.usageId);
    return res.json({ success: true });
  } catch (err) {
    return fail(err, req, res, 'release');
  }
});

export default router;
