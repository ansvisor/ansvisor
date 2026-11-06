import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole } from '../lib/access.js';
import { checkKeyFile, newIndexNowKey, readIndexNow } from '../lib/indexnow.js';
import { cmsLimiter } from '../middleware/rate-limiter.js';
import { brandOf } from './cms.js';

/**
 * A brand's IndexNow (#2142, part B; 00491), on Settings › Integrations.
 * Members read it; admins and managers turn it on (Ansvisor makes the key,
 * on the brand's primary domain), check the key's file, and turn it off:
 *   GET    /api/cms/brands/:brandId/indexnow         its key, host, check, and what keeps it off
 *   POST   /api/cms/brands/:brandId/indexnow         turn it on: a new key, not checked yet
 *   POST   /api/cms/brands/:brandId/indexnow/check   read the key's file back
 *   DELETE /api/cms/brands/:brandId/indexnow         turn it off
 * The key isn't a secret: its file is public on the site.
 */

const router = Router();

const MANAGERS_ONLY = 'Only admins and managers can set up IndexNow.';

/** Answers a failure: an access refusal as it is, anything else logged by name. */
function fail(req, res, err, what) {
  if (err?.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code ?? (err.status === 404 ? 'not_found' : 'forbidden'),
    });
  }
  req.log.error({ err: { name: err?.name } }, what);
  return res.status(500).json({ error: 'Something went wrong with IndexNow', code: 'failed' });
}

async function writeBrand(id, patch) {
  const { error } = await supabaseAdmin.from('brands').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// GET — for every member of the brand.
router.get('/brands/:brandId/indexnow', async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    return res.json({ indexnow: await readIndexNow(id) });
  } catch (err) {
    return fail(req, res, err, 'cms indexnow read error');
  }
});

// POST — turn it on, or make a new key: on the brand's primary domain, not checked yet.
router.post('/brands/:brandId/indexnow', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, MANAGERS_ONLY);
    const now = await readIndexNow(id);
    if (now.blockedBy) {
      return res.status(409).json({
        error: 'This brand’s CMS can’t put a file at the site’s root.',
        code: 'no_root_files',
      });
    }
    if (!now.domainHost) {
      return res.status(409).json({ error: 'The brand has no domain yet.', code: 'no_domain' });
    }
    await writeBrand(id, {
      indexnow_key: newIndexNowKey(),
      indexnow_host: now.domainHost,
      indexnow_verified_at: null,
    });
    return res.json({ indexnow: await readIndexNow(id) });
  } catch (err) {
    return fail(req, res, err, 'cms indexnow on error');
  }
});

// POST — read the key's file at its address; checked, pages are announced from now on.
router.post('/brands/:brandId/indexnow/check', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, MANAGERS_ONLY);
    const now = await readIndexNow(id);
    if (!now.key || !now.host) {
      return res.status(409).json({ error: 'IndexNow isn’t on for this brand.', code: 'off' });
    }
    const found = await checkKeyFile(now.host, now.key);
    if (found.state !== 'ok') {
      return res.status(422).json({ error: 'The key’s file wasn’t found.', code: found.state });
    }
    // The host the file loaded from (example.com → www.example.com): its pages are announced.
    await writeBrand(id, {
      indexnow_host: found.host,
      indexnow_verified_at: new Date().toISOString(),
    });
    return res.json({ indexnow: await readIndexNow(id) });
  } catch (err) {
    return fail(req, res, err, 'cms indexnow check error');
  }
});

// DELETE — turn it off: the key goes, and nothing more is announced.
router.delete('/brands/:brandId/indexnow', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, MANAGERS_ONLY);
    await writeBrand(id, { indexnow_key: null, indexnow_host: null, indexnow_verified_at: null });
    return res.json({ success: true });
  } catch (err) {
    return fail(req, res, err, 'cms indexnow off error');
  }
});

export default router;
