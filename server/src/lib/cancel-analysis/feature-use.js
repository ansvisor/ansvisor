import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';

/**
 * What the organization ever did with Ansvisor's main features, from our own
 * tables, for the analysis's "Not used": one count each, never the rows.
 * Only the real brands count: the demo brand (brands.is_demo, 00380) comes
 * with sample competitors, pages, audits and chats.
 *
 *   * cms: a Webflow, WordPress, Framer or Wix connection
 *     (brand_cms_connections). HubSpot isn't counted: its connection
 *     (brand_integrations) is also the CRM's, so it doesn't say a CMS was
 *     connected;
 *   * competitors: competitors added to a brand;
 *   * content: Content Editor pages (content_drafts), written by hand or by
 *     the agent;
 *   * siteAudit: site audits a person ran (site_audits.source 'user'), not
 *     the monthly automatic ones;
 *   * chat: Chat conversations, on a real brand or the whole workspace.
 *
 * Never throws: a count that can't be read is null.
 */

/** In the order the e-mail lists them, with its words. */
export const FEATURES = [
  { key: 'cms', label: 'Connected a CMS' },
  { key: 'competitors', label: 'Added competitors' },
  { key: 'content', label: 'Created content' },
  { key: 'siteAudit', label: 'Ran a site audit' },
  { key: 'chat', label: 'Used Chat' },
];

/** The brands read at most: an agency's many brands still fit in one filter. */
const MAX_BRANDS = 200;

/**
 * @param {string} orgId
 * @param {{ db?: object }} [options] the service-role client
 * @returns {Promise<Array<{ key: string, label: string, count: number | null }>>}
 */
export async function readFeatureUse(orgId, { db = supabaseAdmin } = {}) {
  const counted = async (label, query) => {
    try {
      const { count, error } = await query();
      if (error) throw new Error(error.message);
      return count ?? 0;
    } catch (err) {
      logger.warn({ err: { name: err?.name }, table: label }, '[cancel-analysis] count not read');
      return null;
    }
  };

  let brandIds = null;
  try {
    const { data, error } = await db
      .from('brands')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_demo', false)
      .limit(MAX_BRANDS);
    if (error) throw new Error(error.message);
    brandIds = (data ?? []).map((brand) => brand.id).filter(Boolean);
  } catch (err) {
    logger.warn({ err: { name: err?.name }, table: 'brands' }, '[cancel-analysis] count not read');
  }

  const head = (table) => db.from(table).select('id', { count: 'exact', head: true });
  const onBrands = (table, more = (query) => query) =>
    brandIds === null
      ? null
      : brandIds.length
        ? counted(table, () => more(head(table).in('brand_id', brandIds)))
        : 0;

  const [cms, competitors, content, siteAudit, chat] = await Promise.all([
    onBrands('brand_cms_connections'),
    onBrands('competitors'),
    onBrands('content_drafts'),
    onBrands('site_audits', (query) => query.eq('source', 'user')),
    brandIds === null
      ? null
      : counted('chat_conversations', () =>
          head('chat_conversations')
            .eq('organization_id', orgId)
            .or(
              brandIds.length
                ? `brand_id.is.null,brand_id.in.(${brandIds.join(',')})`
                : 'brand_id.is.null',
            ),
        ),
  ]);
  const counts = { cms, competitors, content, siteAudit, chat };
  return FEATURES.map(({ key, label }) => ({ key, label, count: counts[key] }));
}
