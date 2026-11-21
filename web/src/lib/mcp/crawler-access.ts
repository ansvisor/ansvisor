import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcp-auth';
import {
  CRAWLER_CHECKS,
  crawlerAccess,
  type AuditedPage,
  type CrawlerAccess,
  type CrawlerSignalRow,
} from '@/lib/audit/crawler-access';
import { readForIds } from '@/lib/shopping/catalog-read';
import { brandAllowed } from './data';

/**
 * The brand's crawler issues across its pages (get_crawler_access_issues):
 * each page's latest completed Site Audit, newest first, up to
 * CRAWLER_PAGES_MAX pages, and those audits' crawler checks
 * (audit/crawler-access.ts). Read through the service role only once the
 * brand is the run's organization's and the person's (brandAllowed), and
 * every row by that brand's id, or by the ids of its own audits. Null for
 * a brand outside them.
 */

/** Pages read at most: their latest audit each. */
export const CRAWLER_PAGES_MAX = 200;
/** Audits read to find them, newest first: a page audited again counts once. */
const AUDITS_READ = 1000;

/** A page's address as the same page: no fragment, no trailing slash, any case. */
const pageKey = (url: string) => url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

export async function getCrawlerAccessFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<CrawlerAccess | null> {
  if (!(await brandAllowed(auth, brandId))) return null;
  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, completed_at, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .order('id')
    .range(0, AUDITS_READ - 1);
  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const pages: AuditedPage[] = [];
  let capped = false;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const url = String(row.url ?? '');
    const key = pageKey(url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    if (pages.length === CRAWLER_PAGES_MAX) {
      capped = true;
      break;
    }
    pages.push({
      auditId: row.id as string,
      url,
      auditedAt: (row.completed_at as string | null) ?? (row.created_at as string),
    });
  }
  if ((data ?? []).length === AUDITS_READ) capped = true;

  const signals = await readForIds(
    pages.map((page) => page.auditId),
    async (some) => {
      const { data: rows, error: readError } = await supabaseAdmin
        .from('audit_signal_results')
        .select('audit_id, signal_key, status, evidence')
        .in('audit_id', some)
        .in('signal_key', [...CRAWLER_CHECKS]);
      if (readError) throw new Error(readError.message);
      return (rows ?? []) as CrawlerSignalRow[];
    },
  );
  return crawlerAccess(pages, signals, capped);
}
