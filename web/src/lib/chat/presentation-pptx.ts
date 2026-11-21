import type { PresentationSlide } from './presentation';

/**
 * Renders a presentation slide model (presentation.ts) as a native,
 * editable .pptx: real PowerPoint text, tables and charts, not pictures.
 * pptxgenjs loads on demand so chat code that never makes a deck never
 * pays for it.
 */

type PptxModule = typeof import('pptxgenjs');
type Pptx = InstanceType<PptxModule['default']>;
type PptxSlide = ReturnType<Pptx['addSlide']>;

const PAGE_W = 13.33;
const MARGIN = 0.6;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = '1A1A2E';
const MUTED = '6B7280';
const ACCENT = '4F46E5';

function slideNote(slide: PptxSlide, note: string): void {
  slide.addText(note, {
    x: MARGIN,
    y: 6.95,
    w: CONTENT_W,
    h: 0.35,
    fontSize: 9,
    color: MUTED,
  });
}

function slideHeading(slide: PptxSlide, heading: string): void {
  slide.addText(heading, {
    x: MARGIN,
    y: 0.35,
    w: CONTENT_W,
    h: 0.6,
    fontSize: 24,
    bold: true,
    color: INK,
  });
}

function renderSlide(pptx: Pptx, model: PresentationSlide): void {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };

  if (model.kind === 'title') {
    slide.addText(model.title, {
      x: MARGIN,
      y: 2.2,
      w: CONTENT_W,
      h: 1.4,
      fontSize: 40,
      bold: true,
      color: INK,
    });
    slide.addText([model.brand, model.period].filter(Boolean).join('  ·  '), {
      x: MARGIN,
      y: 3.7,
      w: CONTENT_W,
      h: 0.5,
      fontSize: 18,
      color: MUTED,
    });
    return;
  }

  if (model.kind === 'summary') {
    slideHeading(slide, model.heading);
    slide.addText(
      model.paragraphs.map((paragraph) => ({
        text: paragraph,
        options: { fontSize: 14, color: INK, paraSpaceAfter: 10, breakLine: true },
      })),
      { x: MARGIN, y: 1.1, w: CONTENT_W, h: 5.2, valign: 'top' },
    );
    if (model.excerpt) {
      slide.addText('The opening of the report’s summary - the full text is on the report.', {
        x: MARGIN,
        y: 6.45,
        w: CONTENT_W,
        h: 0.4,
        fontSize: 10,
        italic: true,
        color: MUTED,
      });
    }
    slideNote(slide, model.note);
    return;
  }

  if (model.kind === 'kpis') {
    slideHeading(slide, model.heading);
    const columns = Math.min(model.cells.length, 3);
    const cellW = CONTENT_W / columns;
    const cellH = 1.5;
    const top = 1.5;
    model.cells.forEach((cell, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = MARGIN + col * cellW;
      const y = top + row * (cellH + 0.25);
      slide.addText(cell.value, {
        x,
        y,
        w: cellW - 0.2,
        h: 0.7,
        fontSize: 28,
        bold: true,
        color: ACCENT,
        align: 'center',
      });
      slide.addText(cell.label + (cell.detail ? `\n${cell.detail}` : ''), {
        x,
        y: y + 0.7,
        w: cellW - 0.2,
        h: 0.8,
        fontSize: 12,
        color: MUTED,
        align: 'center',
        valign: 'top',
      });
    });
    slideNote(slide, model.note);
    return;
  }

  if (model.kind === 'trend') {
    slideHeading(slide, model.heading);
    const series = [
      {
        name: 'AI Visibility Score',
        labels: model.points.map((point) => point.day),
        values: model.points.map((point) => point.score),
      },
    ];
    if (model.competitorPoints && model.competitorPoints.length > 0) {
      series.push({
        name: 'Competitors (avg.)',
        labels: model.competitorPoints.map((point) => point.day),
        values: model.competitorPoints.map((point) => point.score),
      });
    }
    slide.addChart(pptx.ChartType.line, series, {
      x: MARGIN,
      y: 1.1,
      w: CONTENT_W,
      h: 5.4,
      lineSize: 2,
      chartColors: [ACCENT, '9CA3AF'],
      showLegend: series.length > 1,
      legendPos: 'b',
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
    });
    slideNote(slide, model.note);
    return;
  }

  if (model.kind === 'sov') {
    slideHeading(slide, model.heading);
    const change =
      model.change !== null
        ? ` (${model.change >= 0 ? '+' : ''}${Math.round(model.change * 10) / 10}% vs the previous period)`
        : '';
    slide.addText(`Overall share of voice: ${Math.round(model.overall * 10) / 10}%${change}`, {
      x: MARGIN,
      y: 1.0,
      w: CONTENT_W,
      h: 0.4,
      fontSize: 14,
      color: INK,
    });
    slide.addChart(
      pptx.ChartType.bar,
      [
        {
          name: 'Share of voice (%)',
          labels: model.rows.map((row) => row.platform),
          values: model.rows.map((row) => row.pct),
        },
      ],
      {
        x: MARGIN,
        y: 1.5,
        w: CONTENT_W,
        h: 4.9,
        barDir: 'bar',
        chartColors: [ACCENT],
        catAxisLabelFontSize: 10,
        valAxisLabelFontSize: 9,
        showValue: true,
        dataLabelFontSize: 9,
        dataLabelFormatCode: '0.0"%"',
      },
    );
    slideNote(slide, model.note);
    return;
  }

  if (model.kind === 'table') {
    slideHeading(slide, model.heading);
    if (model.shownOf) {
      slide.addText(
        `The first ${model.shownOf.shown} of ${model.shownOf.total}, in the report’s order.`,
        { x: MARGIN, y: 0.95, w: CONTENT_W, h: 0.35, fontSize: 10, italic: true, color: MUTED },
      );
    }
    const head = model.columns.map((column) => ({
      text: column,
      options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT }, fontSize: 11 },
    }));
    const body = model.rows.map((row) =>
      row.map((cell) => ({ text: cell, options: { fontSize: 10, color: INK } })),
    );
    slide.addTable([head, ...body], {
      x: MARGIN,
      y: model.shownOf ? 1.4 : 1.1,
      w: CONTENT_W,
      rowH: 0.4,
      border: { pt: 0.5, color: 'E5E7EB' },
      valign: 'middle',
    });
    slideNote(slide, model.note);
    return;
  }

  // 'missing': the report says which sections could not be gathered.
  slideHeading(slide, model.heading);
  slide.addText(
    'This report was generated without these sections (they could not be gathered for the period):',
    { x: MARGIN, y: 1.2, w: CONTENT_W, h: 0.5, fontSize: 13, color: INK },
  );
  slide.addText(
    model.sections.map((section) => ({
      text: section,
      options: { bullet: true, fontSize: 13, color: INK, paraSpaceAfter: 6, breakLine: true },
    })),
    { x: MARGIN, y: 1.8, w: CONTENT_W, h: 4.5, valign: 'top' },
  );
  slideNote(slide, model.note);
}

/** The deck as a .pptx binary. */
export async function renderPresentationPptx(slides: PresentationSlide[]): Promise<Buffer> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  for (const model of slides) renderSlide(pptx, model);
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
