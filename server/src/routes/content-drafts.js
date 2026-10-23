import { Router } from 'express';
import { z } from 'zod';
import { assertBrandAccess } from '../lib/access.js';
import { fixDraftRules, fixRulesInput } from '../lib/content-agent.js';
import { rebuildDraftBrief, rebuildSources } from '../lib/content-brief.js';
import { stopDraftRun } from '../lib/content-runs.js';
import { startDraftWriting, writeDraftInput } from '../lib/content-writer.js';
import supabaseAdmin from '../config/supabase.js';
import { PlanLimitError } from '../lib/plan-guard.js';

/**
 * Content Editor drafts: Rebuild outline in the editor's Brief tab writes
 * the draft's brief from the sources the person kept (CE-007); Fix open
 * rules with agent leaves the Content Agent's suggestions for review
 * (CE-018); Start's Agent has the Content Agent do the page (CE-015); and
 * Stop ends the agent's run under way, changing nothing (v1.1 CE-027).
 */

const router = Router();

/** The person-facing reason, by status, when the error names none. */
const ERROR_CODES = { 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'invalid' };

const rebuildBody = z.object({
  // guid, not uuid: brand ids aren't all RFC 4122 versions (seeded ones).
  brandId: z.guid(),
  sources: rebuildSources,
});

/**
 * POST /api/content-drafts/:draftId/brief
 * Body: { brandId, sources: { promptIds, fanouts, pages, queries, headings, length } }
 */
router.post('/:draftId/brief', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = rebuildBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, sources } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const brief = await rebuildDraftBrief({ draftId: draftId.data, brandId, sources });
    return res.json({ brief });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft brief rebuild error');
    return res.status(502).json({ error: 'The brief could not be written', code: 'failed' });
  }
});

const fixBody = fixRulesInput.extend({ brandId: z.guid() });

/**
 * POST /api/content-drafts/:draftId/suggestions
 * Body: { brandId, rules: [{ key, name, detail }], textRules, locked }
 * Answers { count, batchId }: the suggestions left for review (none when the
 * agent found nothing it could change); 409 `open_suggestions` while the
 * latest batch is undecided, 409 `published` for a published draft.
 */
router.post('/:draftId/suggestions', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = fixBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await fixDraftRules({ draftId: draftId.data, brandId, input });
    return res.json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent fix error');
    return res.status(502).json({ error: 'The agent could not run', code: 'failed' });
  }
});

const writeBody = writeDraftInput.extend({ brandId: z.guid() });

/**
 * POST /api/content-drafts/:draftId/write
 * Body: { brandId, sources, rules, textRules, locked }
 * Answers 202 { started: true } at once: the agent runs in the background
 * and the draft shows where it is (agent_state). 409 when the draft is marked
 * ready or published (code not_draft), the agent is on it (code writing) or on
 * another of the organization's drafts (code org_writing), or an existing
 * page's suggestions are still open (code open_suggestions).
 */
router.post('/:draftId/write', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = writeBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await startDraftWriting({ draftId: draftId.data, brandId, input });
    return res.status(202).json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent write error');
    return res.status(502).json({ error: 'The agent could not start', code: 'failed' });
  }
});

/**
 * POST /api/content-drafts/:draftId/rewrite
 * Body: as /write ({ brandId, sources, rules, textRules, locked }).
 * Rewrite the page to these rules: the agent rewrites the whole page in the
 * background and leaves it as ONE suggestion to compare and accept or
 * reject. Answers 202 { started: true } at once; 409 as /write (not_draft,
 * writing, org_writing, open_suggestions); 422 when the page has no text
 * (empty) or is too long to send whole (too_long).
 */
router.post('/:draftId/rewrite', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = writeBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await startDraftWriting({
      draftId: draftId.data,
      brandId,
      input,
      rewrite: true,
    });
    return res.status(202).json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent rewrite error');
    return res.status(502).json({ error: 'The agent could not start', code: 'failed' });
  }
});

const stopBody = z.object({ brandId: z.guid(), runId: z.guid().optional() });

/**
 * POST /api/content-drafts/:draftId/stop
 * Body: { brandId, runId? }
 * Stops the Content Agent's run on the draft (CE-027), the one the editor
 * shows when it names it: it keeps nothing of what it had. Answers
 * { stopped }: false when no run was under way.
 */
router.post('/:draftId/stop', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = stopBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, runId } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id')
      .eq('id', draftId.data)
      .maybeSingle();
    if (error) throw error;
    if (!draft || draft.brand_id !== brandId) {
      return res.status(404).json({ error: 'Draft not found', code: 'not_found' });
    }
    const stopped = await stopDraftRun(draftId.data, runId ?? null);
    // A run in the background lets go of the draft once it sees the stop;
    // one no server holds any more never would. The editor opens at once.
    // Only the claim a stopped run holds: a Stop on a Fix or the brief (which
    // hold none) leaves a Start or Rewrite on the same draft its claim.
    for (const { claimed_at: claimedAt } of stopped) {
      if (!claimedAt) continue;
      const { error: letGoError } = await supabaseAdmin
        .from('content_drafts')
        .update({ agent_state: null, agent_state_at: new Date().toISOString() })
        .eq('id', draftId.data)
        .eq('agent_state', 'writing')
        .eq('agent_state_at', claimedAt);
      if (letGoError) throw letGoError;
    }
    return res.json({ stopped: stopped.length > 0 });
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent stop error');
    return res.status(502).json({ error: 'The agent could not be stopped', code: 'failed' });
  }
});

export default router;
