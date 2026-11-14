import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole } from '../lib/access.js';
import { isOrgActive } from '../lib/active-subscriptions.js';
import { readBrandFacts, setFactScope, setFactStatus } from '../lib/brand-facts.js';
import { qualityPhase } from '../lib/content-quality.js';
import { MAX_SCOPE_CHARS, scopeText } from '../lib/fact-scope.js';
import { isDemoBrand } from '../middleware/demo-brand.js';
import { brandFactsLimiter } from '../middleware/rate-limiter.js';

/**
 * A brand's facts (Content Editor Quality, CE-047): read from its own
 * pricing, About and product pages (brand-facts.js), approved or rejected by
 * its members, and compared with its pages in Trust. Off until Quality's
 * phase 2 is live (CONTENT_QUALITY_PHASE).
 */

const router = Router();

const off = (res) => res.status(404).json({ error: 'Not available', code: 'off' });

const CODES = { 403: 'forbidden', 404: 'not_found', 409: 'duplicate' };

/** An error's name and message only: a provider's error carries the page's text. */
function failed(req, res, err, what) {
  if (CODES[err?.status]) {
    return res.status(err.status).json({ error: err.message, code: CODES[err.status] });
  }
  req.log.error({ err: { name: err?.name, message: err?.message, stack: err?.stack } }, what);
  return res.status(500).json({ error: 'Failed to read the brand facts', code: 'failed' });
}

// GET /api/brand-facts?brandId=… — the facts, read from the site on the
// first ask (once, however many ask), else as kept: the editor reads it
// each time its tab comes back, so it has no bucket of its own. Once the
// plan has ended, and on a demo brand (sample facts, 00380), only as kept:
// the site isn't read for it.
router.get('/', async (req, res) => {
  if (qualityPhase() < 2) return off(res);
  const parsed = z.guid().safeParse(req.query.brandId);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { orgId } = await assertBrandAccess(parsed.data, req.user.id);
    const keptOnly = !(await isOrgActive(orgId)) || (await isDemoBrand(parsed.data));
    return res.json(await readBrandFacts(parsed.data, { orgId, keptOnly }));
  } catch (err) {
    return failed(req, res, err, 'brand facts read error');
  }
});

// POST /api/brand-facts/fetch { brandId } — read the site again (not more
// than every few minutes).
router.post('/fetch', brandFactsLimiter, async (req, res) => {
  if (qualityPhase() < 2) return off(res);
  const parsed = z.object({ brandId: z.guid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { orgId } = await assertBrandAccess(parsed.data.brandId, req.user.id);
    // Reading the site again costs a model's read: admins and managers (2026-11-03).
    await assertRole(
      req.user.id,
      MANAGER_ROLES,
      'Only admins and managers can read the brand facts again.',
    );
    return res.json(await readBrandFacts(parsed.data.brandId, { orgId, refresh: true }));
  } catch (err) {
    return failed(req, res, err, 'brand facts fetch error');
  }
});

// A fact's status, or where it holds (00539): a destination, operator or
// route; null, or nothing but spaces, for the whole brand.
const patchBody = z.union([
  z.object({ status: z.enum(['approved', 'rejected']) }).strict(),
  z
    .object({ scope: z.string().max(MAX_SCOPE_CHARS).nullable() })
    .strict()
    .refine(({ scope }) => !scope?.trim() || scopeText(scope)),
]);

// PATCH /api/brand-facts/:id { status } | { scope } — approve or reject a
// fact, or set where it holds.
router.patch('/:id', async (req, res) => {
  if (qualityPhase() < 2) return off(res);
  const id = z.guid().safeParse(req.params.id);
  const body = patchBody.safeParse(req.body);
  if (!id.success || !body.success) {
    return res.status(400).json({ error: 'invalid', code: 'invalid' });
  }
  try {
    const { data: fact, error } = await supabaseAdmin
      .from('brand_facts')
      .select('id, brand_id, kind, slot, scope')
      .eq('id', id.data)
      .maybeSingle();
    if (error) throw error;
    if (!fact) return res.status(404).json({ error: 'Fact not found', code: 'not_found' });
    await assertBrandAccess(fact.brand_id, req.user.id);
    // What Chat's /facts and the Brand Facts Guardian hold drafts to: admins and managers say.
    await assertRole(
      req.user.id,
      MANAGER_ROLES,
      'Only admins and managers can approve or reject brand facts.',
    );
    if ('scope' in body.data) return res.json(await setFactScope(fact, body.data.scope));
    return res.json(await setFactStatus(fact, body.data.status, req.user.id));
  } catch (err) {
    return failed(req, res, err, 'brand fact status error');
  }
});

export default router;
