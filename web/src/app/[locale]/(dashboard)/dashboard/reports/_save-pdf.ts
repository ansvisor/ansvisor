import type { Report } from '@/lib/actions/reports';
import { reportFileName, type ReportBranding } from '@/lib/white-label/kit';
import { pdfImage } from '@/lib/white-label/pdf-image';

/**
 * Draws a saved report as a vector PDF (@react-pdf/renderer) and saves it, in
 * the white label kit's look when there is one. Shared by the report's page
 * and the Reports list's row menu (UX audit RP-09). The renderer and the
 * document load on demand: PDF export is rare and the library is heavy.
 *
 * The caller reads the kit first: a kit that couldn't be read must not turn
 * into a PDF in Ansvisor's look for an agency's client.
 */
export async function saveReportPdf(report: Report, kit: ReportBranding | null): Promise<void> {
  const [{ reportPdf }, logo, clientLogo] = await Promise.all([
    import('./[id]/_report-pdf'),
    pdfImage(kit?.logo ?? null),
    pdfImage(kit?.clientLogo ?? null),
  ]);
  const blob = await reportPdf(report, kit && { ...kit, logo, clientLogo });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFileName(kit, report.payload.brandName, report.dateTo);
  a.click();
  URL.revokeObjectURL(url);
}
