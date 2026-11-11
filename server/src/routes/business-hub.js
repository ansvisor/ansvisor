import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole } from '../lib/access.js';
import { businessHubEnabled } from '../lib/business-hub/flag.js';
import {
  MAX_ENTRIES,
  SnapshotError,
  afterBusinessHubSave,
  listSnapshots,
  parseSnapshot,
  saveSnapshots,
} from '../lib/business-hub/snapshots.js';
import { DEMO_BRAND } from '../middleware/demo-brand.js';

/**
 * ChatGPT Business Hub numbers (00526) under /api/business-hub, behind
 * BUSINESS_HUB_ENABLED.
 *
 *   - Off (the server's flag isn't "true", as in production), every path
 *     here is not found: 404 { code: 'off' }, as brand-facts.js and ads.js.
 *   - Every member of the brand reads and enters the numbers: copying them
 *     from Business Hub is daily work, with no model and no cost
 *     (write-roles.test.js OPEN). Deleting an entry is for admins and
 *     managers, as deletes are.
 *   - The demo brand's entries are sample data: a write naming it is refused
 *     before it gets here (middleware/demo-brand.js), and here too.
 */

const router = Router();

const off = (res) => res.status(404).json({ error: 'Not available', code: 'off' });

// Before every route, so a path added later is hidden with the rest.
router.use((req, res, next) => (businessHubEnabled() ? next() : off(res)));

/** A brand-access or role refusal as it is (403 or 404); a bad entry 400; anything else 500. */
function failed(req, res, err, what) {
  if (err instanceof SnapshotError) {
    return res.status(400).json({
      error: 'invalid',
      code: 'invalid',
      field: err.field,
      reason: err.reason,
      ...(err.row !== null ? { row: err.row } : {}),
    });
  }
  if (err?.status === 403 || err?.status === 404) {
    return res
      .status(err.status)
      .json({ error: err.message, code: err.status === 404 ? 'not_found' : 'forbidden' });
  }
  req.log.error({ err: { name: err?.name, message: err?.message, stack: err?.stack } }, what);
  return res.status(500).json({ error: 'Failed to save the Business Hub numbers', code: 'failed' });
}

/** The brand the path names, once the person may reach it; null after answering. */
async function brandOf(req, res, { write = false } = {}) {
  const parsed = z.guid().safeParse(req.params.brandId);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid', code: 'invalid', field: 'brandId' });
    return null;
  }
  const { brand } = await assertBrandAccess(parsed.data, req.user.id);
  if (write && brand?.is_demo) {
    res.status(402).json(DEMO_BRAND);
    return null;
  }
  return parsed.data;
}

/** After a save, best effort: what follows it never undoes it. */
async function followUp(req, brandId) {
  try {
    await afterBusinessHubSave(brandId);
  } catch (err) {
    req.log.error(
      { err: { name: err?.name, message: err?.message }, brandId },
      'business hub after-save failed',
    );
  }
}

// GET /api/business-hub/:brandId/snapshots — the entries, newest first.
router.get('/:brandId/snapshots', async (req, res) => {
  try {
    const brandId = await brandOf(req, res);
    if (!brandId) return undefined;
    return res.json({ snapshots: await listSnapshots(brandId) });
  } catch (err) {
    return failed(req, res, err, 'business hub snapshots read error');
  }
});

// PUT /api/business-hub/:brandId/snapshots { periodDays, periodEnd, mentions,
// websiteClicks, profileViews, topics } — one entry, by hand, replacing the
// brand's entry of the same length and last day.
router.put('/:brandId/snapshots', async (req, res) => {
  try {
    const brandId = await brandOf(req, res, { write: true });
    if (!brandId) return undefined;
    const row = parseSnapshot(req.body);
    const { saved, replaced } = await saveSnapshots(brandId, [row], {
      userId: req.user.id,
      source: 'manual',
    });
    await followUp(req, brandId);
    return res.json({ snapshot: saved[0] ?? null, replaced: replaced > 0 });
  } catch (err) {
    return failed(req, res, err, 'business hub snapshot save error');
  }
});

// POST /api/business-hub/:brandId/snapshots/import { rows: [...] } — up to
// MAX_ENTRIES entries from Ansvisor's CSV template, all or none: one bad row,
// or two for the same length and last day, saves nothing.
router.post('/:brandId/snapshots/import', async (req, res) => {
  try {
    const brandId = await brandOf(req, res, { write: true });
    if (!brandId) return undefined;
    const body = z
      .object({ rows: z.array(z.unknown()).min(1).max(MAX_ENTRIES) })
      .safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'invalid', code: 'invalid', field: 'rows' });
    }
    const seen = new Set();
    const rows = body.data.rows.map((input, i) => {
      try {
        const row = parseSnapshot(input);
        const key = `${row.period_days}|${row.period_end}`;
        if (seen.has(key)) throw new SnapshotError('periodEnd', 'duplicate');
        seen.add(key);
        return row;
      } catch (err) {
        if (err instanceof SnapshotError) throw new SnapshotError(err.field, err.reason, i);
        throw err;
      }
    });
    const { saved, replaced } = await saveSnapshots(brandId, rows, {
      userId: req.user.id,
      source: 'csv',
    });
    await followUp(req, brandId);
    return res.json({ saved: saved.length, replaced, snapshots: saved });
  } catch (err) {
    return failed(req, res, err, 'business hub snapshot import error');
  }
});

// DELETE /api/business-hub/snapshots/:id — one entry, by an admin or a manager.
router.delete('/snapshots/:id', async (req, res) => {
  const id = z.guid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'invalid', code: 'invalid', field: 'id' });
  try {
    const { data: entry, error } = await supabaseAdmin
      .from('business_hub_snapshots')
      .select('id, brand_id')
      .eq('id', id.data)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!entry) return res.status(404).json({ error: 'Entry not found', code: 'not_found' });
    const { brand } = await assertBrandAccess(entry.brand_id, req.user.id);
    if (brand?.is_demo) return res.status(402).json(DEMO_BRAND);
    await assertRole(
      req.user.id,
      MANAGER_ROLES,
      'Only admins and managers can delete Business Hub numbers.',
    );
    const { error: deleteErr } = await supabaseAdmin
      .from('business_hub_snapshots')
      .delete()
      .eq('id', entry.id);
    if (deleteErr) throw new Error(deleteErr.message);
    return res.json({ deleted: true });
  } catch (err) {
    return failed(req, res, err, 'business hub snapshot delete error');
  }
});

export default router;
