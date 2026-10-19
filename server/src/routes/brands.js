import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { deleteBrand } from '../lib/brand-delete.js';

const router = Router();

/**
 * How long the request waits for the delete before answering that it is
 * still running. Most brands are gone well within it; the largest take
 * minutes, and the deletion carries on after the response.
 */
const WAIT_MS = 20_000;

/**
 * DELETE /api/brands/:id
 * Deletes a brand and all its data. Admins only, as the brands delete policy
 * allows. 200 when it is gone, 202 when it is still being deleted.
 */
router.delete('/:id', async (req, res) => {
  try {
    const brandId = req.params.id;
    await assertBrandAccess(brandId, req.user.id);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    if (profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete a brand.' });
    }

    const job = deleteBrand(brandId);
    const outcome = await Promise.race([
      job.then(() => 'deleted'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), WAIT_MS)),
    ]);
    // A delete that outlives the request must not surface as an unhandled
    // rejection; brand-delete.js has already logged it.
    job.catch(() => {});

    return outcome === 'deleted'
      ? res.json({ deleted: true })
      : res.status(202).json({ deleted: false, pending: true });
  } catch (error) {
    req.log.error({ err: error }, 'delete brand error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to delete the brand.',
    });
  }
});

export default router;
