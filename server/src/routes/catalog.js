import express, { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { syncSource } from '../lib/catalog/sources.js';
import { catalogLimiter } from '../middleware/rate-limiter.js';

/**
 * A brand's catalog sources (#1263, 00279). Members see them through RLS;
 * admins and managers add and remove feed URLs there too. The server syncs:
 *   - POST /api/catalog/sources/:id/sync: a feed read now;
 *   - POST /api/catalog/upload?brandId=…&format=…: a CSV (or XML) file as
 *     the request's body, kept as the brand's upload source.
 */

const router = Router();

const WRITE_ROLES = ['admin', 'manager'];
/** What the API's proxy takes in one request; a larger catalog is a feed URL. */
export const UPLOAD_MAX = '4mb';
/** A feed synced this recently isn't read again on demand. */
const RESYNC_AFTER_MS = 2 * 60 * 1000;
const FORMATS = ['auto', 'google_xml', 'csv', 'meta_csv'];

async function assertWriter(brandId, userId) {
  await assertBrandAccess(brandId, userId);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!WRITE_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can sync the catalog.');
    err.status = 403;
    throw err;
  }
}

function fail(req, res, err, what) {
  if (err?.status === 403 || err?.status === 404) {
    return res.status(err.status).json({
      error: err.message,
      code:
        err.code === 'not_in_workspace'
          ? 'not_in_workspace'
          : err.status === 404
            ? 'not_found'
            : 'forbidden',
    });
  }
  req.log.error({ err: { name: err?.name, message: err?.message } }, what);
  return res.status(500).json({ error: 'Failed to sync the catalog', code: 'failed' });
}

const outcomeBody = (outcome) => ({
  status: outcome.status,
  error: outcome.error ?? null,
  counts: outcome.counts ?? null,
});

// POST /api/catalog/sources/:id/sync — read a feed now.
router.post('/sources/:id/sync', catalogLimiter, async (req, res) => {
  const parsed = z.guid().safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const { data: source } = await supabaseAdmin
      .from('catalog_sources')
      .select('id, brand_id, kind, format, url, last_synced_at')
      .eq('id', parsed.data)
      .maybeSingle();
    if (!source || source.kind !== 'feed_url') {
      return res.status(404).json({ error: 'Not found', code: 'not_found' });
    }
    await assertWriter(source.brand_id, req.user.id);
    if (source.last_synced_at && Date.now() - Date.parse(source.last_synced_at) < RESYNC_AFTER_MS) {
      return res.status(409).json({ error: 'Synced a moment ago', code: 'recent' });
    }
    return res.json(outcomeBody(await syncSource(source)));
  } catch (err) {
    return fail(req, res, err, 'catalog sync error');
  }
});

// POST /api/catalog/upload?brandId=…&format=… — a file's text as the body.
router.post(
  '/upload',
  catalogLimiter,
  express.text({ type: () => true, limit: UPLOAD_MAX }),
  async (req, res) => {
    const parsed = z
      .object({ brandId: z.guid(), format: z.enum(FORMATS).default('auto') })
      .safeParse(req.query);
    if (!parsed.success || typeof req.body !== 'string' || !req.body.trim()) {
      return res.status(400).json({ error: 'invalid', code: 'invalid' });
    }
    const { brandId, format } = parsed.data;
    try {
      await assertWriter(brandId, req.user.id);
      // The brand's one upload source: made on its first upload, its format kept.
      let { data: source } = await supabaseAdmin
        .from('catalog_sources')
        .select('id, brand_id, kind, format, url')
        .eq('brand_id', brandId)
        .eq('kind', 'upload')
        .maybeSingle();
      if (!source) {
        const { data, error } = await supabaseAdmin
          .from('catalog_sources')
          .insert({ brand_id: brandId, kind: 'upload', format, created_by: req.user.id })
          .select('id, brand_id, kind, format, url')
          .single();
        if (error?.code === '23514') {
          return res.status(409).json({ error: error.message, code: 'too_many' });
        }
        if (error) throw new Error(error.message);
        source = data;
      } else if (source.format !== format) {
        await supabaseAdmin.from('catalog_sources').update({ format }).eq('id', source.id);
        source = { ...source, format };
      }
      return res.json(outcomeBody(await syncSource(source, { text: req.body })));
    } catch (err) {
      return fail(req, res, err, 'catalog upload error');
    }
  },
);

// A body over UPLOAD_MAX: said, not a 500.
router.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The file is larger than 4 MB', code: 'too_large' });
  }
  return next(err);
});

export default router;
