/**
 * Report template registry (US-1.1) — the four ready-made report shapes a
 * user can generate without building anything from scratch. A template
 * decides which payload sections `createReport` gathers and, since the
 * detail page and the PDF both render by payload-field presence, which
 * sections show up in the output. Names/descriptions live in the `reports`
 * i18n namespace under `templates.<id>.*`.
 *
 * Template ids are persisted in `reports.template`, so they are part of the
 * data contract: never rename an id, only add new ones. `executive_summary`
 * predates this registry (Simple Reports MVP) and stays the full report.
 */

export type ReportTemplateId =
  | 'weekly_visibility'
  | 'executive_summary'
  | 'competitor_benchmark'
  | 'citation_sources';

export type ReportSection =
  | 'kpis'
  | 'trend'
  | 'shareOfVoice'
  | 'competitors'
  | 'promptPerformance'
  | 'queryFanout'
  | 'citations';

export interface ReportTemplateDef {
  id: ReportTemplateId;
  /** Payload sections this template gathers and renders (AI summary is always included). */
  sections: ReportSection[];
  /** Date-range preset the generate dialog starts on (user can still override). */
  defaultPreset: '7d' | '30d' | '90d';
}

export const REPORT_TEMPLATES: ReportTemplateDef[] = [
  {
    id: 'weekly_visibility',
    sections: ['kpis', 'trend', 'shareOfVoice'],
    defaultPreset: '7d',
  },
  {
    id: 'executive_summary',
    sections: [
      'kpis',
      'trend',
      'shareOfVoice',
      'competitors',
      'promptPerformance',
      'queryFanout',
      'citations',
    ],
    defaultPreset: '30d',
  },
  {
    id: 'competitor_benchmark',
    sections: ['kpis', 'shareOfVoice', 'competitors'],
    defaultPreset: '30d',
  },
  {
    id: 'citation_sources',
    sections: ['citations'],
    defaultPreset: '30d',
  },
];

/** Falls back to the full executive summary for unknown/legacy ids. */
export function getReportTemplate(id: string | null | undefined): ReportTemplateDef {
  return (
    REPORT_TEMPLATES.find((t) => t.id === id) ??
    REPORT_TEMPLATES.find((t) => t.id === 'executive_summary')!
  );
}

export function templateHasSection(id: string | null | undefined, section: ReportSection): boolean {
  return getReportTemplate(id).sections.includes(section);
}
