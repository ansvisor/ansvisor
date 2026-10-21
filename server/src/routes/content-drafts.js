import { Router } from 'express';
import { z } from 'zod';
import { assertBrandAccess } from '../lib/access.js';
import { rebuildDraftBrief, rebuildSources } from '../lib/content-brief.js';
import { PlanLimitError } from '../lib/plan-guard.js';

/**
 * Content Editor drafts (CE-007): Rebuild outline in the editor's Brief tab
 * writes the draft's brief from the sources the person kept.
 */

const router = Router();

/** The person-facing reason, by status, when the error names none. */
const ERROR_CODES = { 403: 'forbidden', 404: 'not_found', 422: 'invalid' };

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

export default router;
