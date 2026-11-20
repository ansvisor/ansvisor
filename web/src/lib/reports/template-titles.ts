import type { ReportTemplateId } from '@/lib/reports/templates';

/**
 * Each template's name in English, as the template picker names it
 * (reports.templates.*.name), and as a report's stored (immutable) title
 * reads by default. A new report's default title is the name alone: the list
 * and the report show the period beside it (UX audit RP-12).
 */
export const REPORT_TEMPLATE_TITLES: Record<ReportTemplateId, string> = {
  weekly_visibility: 'Weekly Visibility Summary',
  executive_summary: 'Monthly Executive Report',
  competitor_benchmark: 'Competitor Benchmark',
  citation_sources: 'Citation & Sources Report',
};
