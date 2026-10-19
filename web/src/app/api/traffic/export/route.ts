import { createTranslator } from 'next-intl';
import { strToU8, zipSync } from 'fflate';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import messages from '../../../../../messages/en.json';
import { createClient } from '@/lib/supabase/server';
import {
  getTrafficConversions,
  getTrafficGooglePages,
  getTrafficPages,
  getTrafficSources,
  getTrafficSummary,
  getTrafficTrend,
  getTrafficVisitsForExport,
  getUntrackedGoogleQueries,
} from '@/lib/actions/traffic';
import { utcDay } from '@/lib/dates';
import { UNTRACKED_QUERY_SCAN } from '@/lib/traffic-google-pages';
import {
  TRAFFIC_EXPORT_MAX_ROWS,
  TRAFFIC_EXPORT_SECTIONS,
  fileSlug,
  filtersTable,
  tableCsv,
  trafficExportFileName,
  trafficTable,
  trafficWorkbook,
  type ExportLabel,
  type TrafficExportData,
  type TrafficExportSection,
} from '@/lib/traffic-export';

/**
 * GET /api/traffic/export — the AI Traffic page as a file (AT-015, spec
 * §3.9), built here rather than in the browser: the whole page as Excel (a
 * sheet per section and a Filters sheet) or as a zip of CSVs, or one table
 * as Excel or CSV. Same range and filters as the page, every row.
 *
 * Reads through the signed-in member's session, so RLS decides whose brand
 * this is: a brand outside their organization reads as not found.
 */

export const runtime = 'nodejs';

const query = z
  .object({
    brandId: z.guid(),
    // The page's window, as its loaders take it; absent for all time.
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    rangeLabel: z.string().max(80).default(''),
    platform: z.string().max(255).optional(),
    search: z.string().max(500).optional(),
    format: z.enum(['xlsx', 'zip', 'csv']),
    section: z.enum(TRAFFIC_EXPORT_SECTIONS).optional(),
  })
  // The zip is the whole page; a CSV is one table.
  .refine((q) => (q.format === 'zip' ? !q.section : q.format === 'csv' ? !!q.section : true));

const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  csv: 'text/csv; charset=utf-8',
} as const;

function exportLabels(): ExportLabel {
  const t = createTranslator({ locale: 'en', messages, namespace: 'traffic.export' });
  return (key, values) => t(key as never, values as never);
}

export async function GET(req: Request) {
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const q = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug')
    .eq('id', q.brandId)
    .maybeSingle();
  if (!brand) return Response.json({ error: 'not_found' }, { status: 404 });

  const sections: readonly TrafficExportSection[] = q.section
    ? [q.section]
    : TRAFFIC_EXPORT_SECTIONS;
  const needs = (...wanted: TrafficExportSection[]) => sections.some((s) => wanted.includes(s));
  const window = { dateFrom: q.from, dateTo: q.to };
  const wholePage = !q.section;

  try {
    const [summary, trend, visits, sources, pageStatus, conversions, googlePages, googleQueries] =
      await Promise.all([
        needs('kpis', 'platforms', 'pages')
          ? getTrafficSummary(q.brandId, window, { topPages: Number.MAX_SAFE_INTEGER })
          : undefined,
        needs('trend') ? getTrafficTrend(q.brandId, window) : undefined,
        needs('visits')
          ? getTrafficVisitsForExport(q.brandId, {
              ...window,
              platform: q.platform,
              search: q.search,
              max: TRAFFIC_EXPORT_MAX_ROWS,
            })
          : undefined,
        // For the Filters sheet.
        wholePage ? getTrafficSources(q.brandId).catch(() => null) : undefined,
        // Every page of the Pages section, with its lists (AT-006).
        needs('pageStatus')
          ? getTrafficPages(q.brandId, window, { tab: 'all', limit: TRAFFIC_EXPORT_MAX_ROWS })
          : undefined,
        // Every row of where AI visitors convert, over the window the page reads (AT-014).
        needs('convertingPages', 'buyerAnswers')
          ? getTrafficConversions(q.brandId, window, { limit: TRAFFIC_EXPORT_MAX_ROWS })
          : undefined,
        // Every page of Is AI taking Google clicks?, over the days it compares (AT-008).
        needs('googlePages')
          ? getTrafficGooglePages(q.brandId, window, { limit: TRAFFIC_EXPORT_MAX_ROWS })
          : undefined,
        // Every Google query no tracked prompt covers, as far as the server checks (AT-009).
        needs('googleQueries')
          ? getUntrackedGoogleQueries(q.brandId, window, { limit: UNTRACKED_QUERY_SCAN })
          : undefined,
      ]);
    // Larger than an export built on request should be (spec §3.9).
    if (visits === null) return Response.json({ error: 'too_large' }, { status: 413 });

    const label = exportLabels();
    const from = utcDay(q.from) ?? null;
    const to = utcDay(q.to) ?? new Date().toISOString().slice(0, 10);
    const data: TrafficExportData = {
      brandName: brand.name as string,
      rangeLabel: q.rangeLabel,
      from,
      to,
      platform: q.platform ?? null,
      search: q.search ?? null,
      exportedAt: new Date(),
      summary,
      trend,
      visits: visits ?? undefined,
      pageStatus,
      conversions,
      googlePages,
      googleQueries,
      sources,
    };

    const fileName = trafficExportFileName({
      brand: (brand.slug as string | null) || (brand.name as string),
      from,
      to,
      ext: q.format,
      table: q.section ? label(`sheets.${q.section}`) : undefined,
    });

    let body: BodyInit;
    if (q.format === 'xlsx') {
      body = new Uint8Array(
        await writeXlsxFile(
          trafficWorkbook(data, sections, label, { withFilters: wholePage }),
        ).toBuffer(),
      );
    } else if (q.format === 'csv') {
      body = tableCsv(trafficTable(q.section!, data, label));
    } else {
      const files: Record<string, Uint8Array> = {
        [`${fileSlug(label('sheets.filters'))}.csv`]: strToU8(tableCsv(filtersTable(data, label))),
      };
      for (const section of sections) {
        files[`${fileSlug(label(`sheets.${section}`))}.csv`] = strToU8(
          tableCsv(trafficTable(section, data, label)),
        );
      }
      body = zipSync(files);
    }

    return new Response(body, {
      headers: {
        'Content-Type': CONTENT_TYPES[q.format],
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[traffic-export] failed:', err);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
