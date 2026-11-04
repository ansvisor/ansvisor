// @vitest-environment node
import path from 'node:path';
import { Font } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import type { Report } from '@/lib/actions/reports';
import { pdfText } from '@/lib/testing/pdf-text';
import { reportPdf } from './_report-pdf';

/**
 * Two reports' PDFs drawn one after the other, as in one tab: the second
 * keeps every letter. With one Inter for both, the first PDF's "i" (Inter
 * draws it from a dotless "ı" and a dot) left the second without its "ı"s
 * and some letters next to them ("Kış" printed as "ş").
 */

const FONTS = path.join(process.cwd(), 'public', 'fonts');

const report = (title: string, brandName: string, summaryText: string): Report => ({
  id: 'r1',
  brandId: 'b1',
  title,
  template: 'monthly',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  createdAt: '2026-10-31T09:00:00Z',
  payload: { brandName, summaryText } as Report['payload'],
});

/** Text without spaces or line breaks: a line may wrap anywhere. */
const squash = (text: string) => text.replace(/\s+/g, '');

/** The letters a PDF shows. */
async function shown(pdf: Blob) {
  return squash(pdfText(new Uint8Array(await pdf.arrayBuffer())));
}

describe('reportPdf', () => {
  it('keeps every letter of a PDF drawn after another one, and leaves no font behind', async () => {
    const families = Font.getRegisteredFontFamilies().length;
    const english = await shown(
      await reportPdf(
        report(
          'October report',
          'Brewline',
          'Brewline Coffee whole bean subscriptions and gift boxes',
        ),
        null,
        FONTS,
      ),
    );
    expect(english).toContain('Octoberreport');
    expect(english).toContain(squash('Brewline Coffee whole bean subscriptions and gift boxes'));

    const summary = 'Kış sporları ve kayak turları için en iyi merkezler hangileri? ığüşöç İĞÜŞÖÇ';
    const turkish = await shown(
      await reportPdf(report('Kış raporu', 'Kayak İşleri', summary), null, FONTS),
    );
    // The title in bold, the brand and the summary in regular.
    expect(turkish).toContain('Kışraporu');
    expect(turkish).toContain('Kayakİşleri');
    expect(turkish).toContain(squash(summary));
    expect(Font.getRegisteredFontFamilies()).toHaveLength(families);
  }, 30_000);
});
