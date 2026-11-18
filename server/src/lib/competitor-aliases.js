/**
 * Merged competitors (00543). A brand that tracked one company twice merges
 * them: the duplicates leave the competitors table for merged_competitors,
 * which keeps each one's name and domain with the competitor it was merged
 * into. From the merge on, those names and domains are the kept one's other
 * names: an answer naming any of them counts for the kept one.
 *
 * Only new answers change. The history of a merged competitor stays under its
 * own id, so nothing here reads answers or rollups: the brand's competitors
 * and its merged ones are a few rows each, read when a run or a callback
 * starts (there is no cache to refresh on a merge).
 */
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { withMergedNames } from './merged-names.js';

export { competitorsAt, withMergedNames } from './merged-names.js';

/** A database without merged_competitors yet (the API deployed ahead of 00543). */
const missingTable = (error) =>
  (error?.code === '42P01' || error?.code === 'PGRST205') &&
  String(error.message ?? '').includes('merged_competitors');

/**
 * The brand's merged competitors (00543): who they were merged into, their
 * names and domains and when. An empty list when the read fails (a database
 * without 00543 yet, say): tracking then counts as before the merge, which
 * is never worse than not tracking.
 */
export async function readMergedCompetitors(brandId) {
  const { data, error } = await supabaseAdmin
    .from('merged_competitors')
    .select('id, merged_into_id, name, domain, merged_at')
    .eq('brand_id', brandId);
  if (error) {
    if (!missingTable(error)) {
      logger.warn({ err: error, brandId }, 'merged competitors not read: counting without them');
    }
    return [];
  }
  return data ?? [];
}

/**
 * The brand's tracked competitors, as tracking counts an answer with them:
 * id, name, domain and the names and domains merged into each.
 */
export async function loadTrackedCompetitors(brandId) {
  const [{ data: competitorRows }, mergedRows] = await Promise.all([
    supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', brandId),
    readMergedCompetitors(brandId),
  ]);
  const competitors = (competitorRows || []).map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain || '',
  }));
  return withMergedNames(competitors, mergedRows);
}

/**
 * The domains of the brand's merged competitors: still a competitor's site
 * (the one they were merged into), so never a source to earn a link or a
 * citation from, as the tracked ones' aren't.
 */
export async function mergedCompetitorDomains(brandId) {
  return (await readMergedCompetitors(brandId)).map((row) => row.domain).filter(Boolean);
}
