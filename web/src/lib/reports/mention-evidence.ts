import type { ReportMentionEvidence } from '@/lib/actions/reports';
import { markdownToPlainText } from '@/lib/markdown-plain';

/**
 * A report's mention evidence as it is shown: newest first, each passage as
 * plain text (UX audit RP-03, RP-04). Reports saved before their passages
 * were cleaned on writing read the same way.
 */
export function shownMentionEvidence(
  evidence: readonly ReportMentionEvidence[],
): ReportMentionEvidence[] {
  return evidence
    .map((row) => ({ ...row, excerpt: markdownToPlainText(row.excerpt) }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
