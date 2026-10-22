import type { ContentBrief, ContentOpportunity } from '@/types';

/** `blog_post` → `Blog post`. */
function humanize(slug: string): string {
  const words = slug.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function section(title: string, lines: (string | null | undefined | false)[]): string | null {
  const body = lines.filter((l): l is string => typeof l === 'string' && l.length > 0);
  return body.length ? `## ${title}\n\n${body.join('\n')}` : null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Everything the opportunity detail shows, as Markdown in page order, for the
 * Copy All Data button. Empty sections are left out.
 */
export function opportunityToMarkdown(
  opportunity: ContentOpportunity,
  brief: ContentBrief | null,
  fanoutQueries: { query: string }[] = [],
  /** An asset's type as the page names it (useAssetTypeLabel); else its key, humanized. */
  assetTypeLabel: (type: string) => string | null = () => null,
): string {
  const sd = opportunity.sourceData;
  const parts: (string | null)[] = [];

  parts.push([`# ${opportunity.title}`, opportunity.description].filter(Boolean).join('\n\n'));

  parts.push(
    [
      `- Type: ${humanize(opportunity.type)}`,
      `- Impact: ${humanize(opportunity.impact)}`,
      `- Status: ${humanize(opportunity.status)}`,
      `- Score: ${Math.round(opportunity.opportunityScore)}`,
      `- Created: ${opportunity.createdAt.slice(0, 10)}`,
      opportunity.decision && `- Decision: ${humanize(opportunity.decision)}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // Sent from an Action Center task (AC-004): what the task says to do.
  const task = sd.fromAction?.task;
  parts.push(
    section(
      sd.fromAction?.actionNo != null
        ? `From a task in AC-${sd.fromAction.actionNo}`
        : 'From an Action Center task',
      [
        task?.where && `- Where: ${task.where}`,
        task?.why && `- Why: ${task.why}`,
        ...(task?.how ?? []).map((step, i) => `${i + 1}. ${step}`),
        task?.doneWhen && `- Done when: ${task.doneWhen}`,
        (task?.effort || task?.role) &&
          `- Effort: ${[task?.effort, task?.role].filter(Boolean).join(' · ')}`,
      ],
    ),
  );

  parts.push(
    section(
      'Target pages',
      (sd.targetPages ?? []).map((p) => `- ${p.title ? `${p.title}: ` : ''}${p.url}`),
    ),
  );

  parts.push(
    section(
      'Recommended assets',
      (sd.assets ?? []).map(
        (a) =>
          `- ${a.title} (${assetTypeLabel(a.type) ?? humanize(a.type)}, ${humanize(a.channel)}, ${humanize(a.decision)})`,
      ),
    ),
  );

  const sc = sd.scoreComponents;
  parts.push(
    section('Score breakdown', [
      sc && `- Demand: ${Math.round(sc.demand)}`,
      sc && `- Visibility gap: ${Math.round(sc.visibilityGap)}`,
      sc && `- Competitor gap: ${Math.round(sc.competitorGap)}`,
      sc && `- Intent: ${Math.round(sc.intent)}`,
    ]),
  );

  const queries = sd.queries?.top.map((q) => q.query) ?? fanoutQueries.map((q) => q.query);
  parts.push(
    section('Source data', [
      sd.promptText && `- Related prompt: ${sd.promptText}`,
      sd.clusterLabel && `- Cluster: ${sd.clusterLabel}`,
      sd.topicName && `- Topic: ${sd.topicName}`,
      sd.estAiVolume != null && `- Est. AI volume: ${fmt(sd.estAiVolume)}`,
      sd.visibilityScore != null && `- Visibility: ${Math.round(sd.visibilityScore)}%`,
      sd.competitorGap != null && `- Competitor gap: ${Math.round(sd.competitorGap)}%`,
      sd.intent && `- Intent: ${sd.intent}`,
      !!sd.keywords?.length && `- Keywords: ${sd.keywords.join(', ')}`,
      !!sd.competitorsCited?.length && `- Competitors cited: ${sd.competitorsCited.join(', ')}`,
    ]),
  );

  parts.push(
    section(
      'Prompts',
      (sd.prompts ?? []).map((p) => `- ${p}`),
    ),
  );
  parts.push(
    section(
      'Fan-out queries',
      queries.map((q) => `- ${q}`),
    ),
  );

  if (brief) {
    parts.push(
      section('Content brief', [
        `- Suggested title: ${brief.suggestedTitle}`,
        `- Content type: ${brief.contentType}`,
        `- Target word count: ${fmt(brief.targetWordCount)}`,
        brief.targetKeywords.length > 0 && `- Keywords: ${brief.targetKeywords.join(', ')}`,
        brief.callToAction && `- CTA: ${brief.callToAction}`,
      ]),
    );
    parts.push(
      brief.outline.length
        ? `## Brief outline\n\n${brief.outline
            .map(
              (s, i) => `${i + 1}. ${s.heading}${s.keyPoints.map((k) => `\n   - ${k}`).join('')}`,
            )
            .join('\n')}`
        : null,
    );
    parts.push(
      brief.competitorInsights ? `## Competitor insights\n\n${brief.competitorInsights}` : null,
    );
  }

  return parts.filter((p): p is string => !!p).join('\n\n') + '\n';
}
