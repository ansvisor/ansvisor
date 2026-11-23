import messages from '../../../messages/en.json';
import type { ReportPayload } from '@/lib/actions/reports';

/**
 * A saved report as an editable deck (issue #2298): the slide model Chat's
 * make_presentation builds from the report's stored payload, and the
 * renderer (presentation-pptx) turns into native PowerPoint text, charts
 * and tables. Every figure comes from the saved payload as it was stored -
 * nothing is recalculated or filled in - and every data slide names its
 * source report and period. Sections the report could not gather are
 * listed, not silently skipped.
 */

/** The saved report a deck is made from (getReportFor's row). */
export interface PresentationReport {
  title: string;
  date_from: string;
  date_to: string;
  payload: ReportPayload;
}

/** One KPI cell on the metrics slide. */
export interface KpiCell {
  label: string;
  value: string;
  /** A smaller second line, e.g. "14 of 20 prompts". */
  detail?: string;
}

export type PresentationSlide =
  | { kind: 'title'; title: string; brand: string; period: string }
  | { kind: 'summary'; heading: string; note: string; paragraphs: string[]; excerpt: boolean }
  | { kind: 'kpis'; heading: string; note: string; cells: KpiCell[] }
  | {
      kind: 'trend';
      heading: string;
      note: string;
      points: { day: string; score: number }[];
      competitorPoints: { day: string; score: number }[] | null;
    }
  | {
      kind: 'sov';
      heading: string;
      note: string;
      overall: number;
      change: number | null;
      rows: { platform: string; pct: number }[];
    }
  | {
      kind: 'table';
      heading: string;
      note: string;
      columns: string[];
      rows: string[][];
      /** The cap, when the report holds more rows than the slide: no silent loss. */
      shownOf: { shown: number; total: number } | null;
    }
  | { kind: 'missing'; heading: string; note: string; sections: string[] };

/** The most rows a table slide holds; the payload's own caps are smaller. */
export const PRESENTATION_TABLE_ROWS = 10;

/** The most characters of the summary one slide holds. */
export const PRESENTATION_SUMMARY_CHARS = 1200;

/** Section names as the Reports page names them (reports.sections), the id if unknown. */
const SECTION_LABELS =
  (messages as unknown as { reports?: { sections?: Record<string, string> } }).reports?.sections ??
  {};

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section;
}

/** Where a figure came from, on every data slide. */
export function sourceNote(report: PresentationReport): string {
  return `Source: saved report “${report.title}” · ${report.date_from} – ${report.date_to}`;
}

const pct = (value: number) => `${Math.round(value * 10) / 10}%`;
const score = (value: number) => String(Math.round(value * 10) / 10);

/** A change as " (+4.2%)" or "" when there is no honest comparison. */
function changeText(change: number | null | undefined): string {
  if (change === null || change === undefined) return '';
  const rounded = Math.round(change * 10) / 10;
  return ` (${rounded >= 0 ? '+' : ''}${rounded}%)`;
}

/** The report as slides, in deck order. A section absent from the payload makes no slide. */
export function presentationSlides(report: PresentationReport): PresentationSlide[] {
  const p = report.payload;
  const note = sourceNote(report);
  const slides: PresentationSlide[] = [
    {
      kind: 'title',
      title: report.title,
      brand: p.brandName,
      period: `${report.date_from} – ${report.date_to}`,
    },
  ];

  const summary = p.summaryText?.trim();
  if (summary) {
    slides.push({
      kind: 'summary',
      heading: 'Summary',
      note,
      paragraphs:
        summary.length <= PRESENTATION_SUMMARY_CHARS
          ? [summary]
          : // A long summary splits on a paragraph or sentence boundary, never mid-word.
            [summary.slice(0, PRESENTATION_SUMMARY_CHARS).replace(/\s+\S*$/, '') + '…'],
      excerpt: summary.length > PRESENTATION_SUMMARY_CHARS,
    });
  }

  const cells: KpiCell[] = [];
  if (p.visibilityRate) {
    if (p.visibilityRate.score !== null && p.visibilityRate.score !== undefined) {
      cells.push({ label: 'AI Visibility Score', value: score(p.visibilityRate.score) });
    }
    cells.push({
      label: 'Visibility rate',
      value: pct(p.visibilityRate.ratePct),
      detail: `${p.visibilityRate.visiblePrompts} of ${p.visibilityRate.promptCount} prompts`,
    });
  }
  if (p.insights) {
    if (!p.visibilityRate) {
      cells.push({ label: 'AI Visibility Score', value: score(p.insights.avgVisibilityScore) });
    }
    cells.push({
      label: 'Mentions',
      value: String(p.insights.totalMentions) + changeText(p.insights.mentionsChange),
    });
    cells.push({
      label: 'Citations',
      value: String(p.insights.totalCitations) + changeText(p.insights.citationsChange),
    });
    cells.push({
      label: 'Positive sentiment',
      value: pct(p.insights.positiveSentimentPct),
    });
  }
  if (p.shareOfVoice) {
    cells.push({
      label: 'Share of voice',
      value: pct(p.shareOfVoice.overallSov) + changeText(p.shareOfVoice.overallSovChange),
    });
  }
  if (cells.length > 0) {
    slides.push({ kind: 'kpis', heading: 'Key figures', note, cells });
  }

  if (p.visibilityTrend && p.visibilityTrend.length > 0) {
    slides.push({
      kind: 'trend',
      heading: 'Visibility trend',
      note,
      points: p.visibilityTrend.map((point) => ({ day: point.date, score: point.score })),
      competitorPoints: p.visibilityTrend.some((point) => point.competitors !== null)
        ? p.visibilityTrend
            .filter((point) => point.competitors !== null)
            .map((point) => ({ day: point.date, score: point.competitors as number }))
        : null,
    });
  }

  if (p.shareOfVoice && p.shareOfVoice.byPlatform.length > 0) {
    slides.push({
      kind: 'sov',
      heading: 'Share of voice',
      note,
      overall: p.shareOfVoice.overallSov,
      change: p.shareOfVoice.overallSovChange,
      rows: p.shareOfVoice.byPlatform.map((row) => ({ platform: row.provider, pct: row.sov })),
    });
  }

  if (p.competitors && p.competitors.length > 0) {
    slides.push({
      kind: 'table',
      heading: 'Competitors',
      note,
      columns: ['Brand', 'Visibility rate', 'Visible prompts', 'Avg. score'],
      rows: p.competitors
        .slice(0, PRESENTATION_TABLE_ROWS)
        .map((entry) => [
          entry.name,
          pct(entry.visibilityRate),
          `${entry.visiblePrompts} of ${entry.promptCount}`,
          score(entry.avgVisibilityScore),
        ]),
      shownOf:
        p.competitors.length > PRESENTATION_TABLE_ROWS
          ? { shown: PRESENTATION_TABLE_ROWS, total: p.competitors.length }
          : null,
    });
  }

  if (
    p.promptPerformance &&
    (p.promptPerformance.best.length > 0 || p.promptPerformance.worst.length > 0)
  ) {
    const rate = (row: { visibilityRate?: number; avgVisibility: number }) =>
      row.visibilityRate !== undefined ? pct(row.visibilityRate) : score(row.avgVisibility);
    slides.push({
      kind: 'table',
      heading: 'Best prompts',
      note,
      columns: ['Prompt', 'Visibility', 'Mentions', 'Runs'],
      rows: p.promptPerformance.best
        .slice(0, PRESENTATION_TABLE_ROWS)
        .map((row) => [row.text, rate(row), String(row.totalMentions), String(row.runs)]),
      shownOf:
        p.promptPerformance.best.length > PRESENTATION_TABLE_ROWS
          ? { shown: PRESENTATION_TABLE_ROWS, total: p.promptPerformance.best.length }
          : null,
    });
    if (p.promptPerformance.worst.length > 0) {
      slides.push({
        kind: 'table',
        heading: 'Prompts needing work',
        note,
        columns: ['Prompt', 'Visibility', 'Mentions', 'Runs'],
        rows: p.promptPerformance.worst
          .slice(0, PRESENTATION_TABLE_ROWS)
          .map((row) => [row.text, rate(row), String(row.totalMentions), String(row.runs)]),
        shownOf:
          p.promptPerformance.worst.length > PRESENTATION_TABLE_ROWS
            ? { shown: PRESENTATION_TABLE_ROWS, total: p.promptPerformance.worst.length }
            : null,
      });
    }
  }

  if (p.topicPerformance && p.topicPerformance.length > 0) {
    slides.push({
      kind: 'table',
      heading: 'Topics',
      note,
      columns: ['Topic', 'Visibility', 'Change'],
      rows: p.topicPerformance
        .slice(0, PRESENTATION_TABLE_ROWS)
        .map((row) => [
          row.name,
          row.visibilityRate !== undefined ? pct(row.visibilityRate) : score(row.avgVisibility),
          row.change !== null && row.change !== undefined
            ? `${row.change >= 0 ? '+' : ''}${Math.round(row.change * 10) / 10}`
            : '—',
        ]),
      shownOf:
        p.topicPerformance.length > PRESENTATION_TABLE_ROWS
          ? { shown: PRESENTATION_TABLE_ROWS, total: p.topicPerformance.length }
          : null,
    });
  }

  if (p.citations && p.citations.topDomains.length > 0) {
    slides.push({
      kind: 'table',
      heading: 'Top citation sources',
      note,
      columns: ['Domain', 'Category', 'Citations', 'Results citing'],
      rows: p.citations.topDomains
        .slice(0, PRESENTATION_TABLE_ROWS)
        .map((row) => [
          row.domain,
          row.category,
          String(row.totalCitations),
          String(row.resultsCiting),
        ]),
      shownOf:
        p.citations.topDomains.length > PRESENTATION_TABLE_ROWS
          ? { shown: PRESENTATION_TABLE_ROWS, total: p.citations.topDomains.length }
          : null,
    });
  }

  if (p.missingSections && p.missingSections.length > 0) {
    slides.push({
      kind: 'missing',
      heading: 'Not in this report',
      note,
      sections: p.missingSections.map(sectionLabel),
    });
  }

  return slides;
}
