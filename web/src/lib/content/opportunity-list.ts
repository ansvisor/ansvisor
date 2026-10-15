import type { ContentOpportunity } from '@/types';

/**
 * How the Content Opportunities list orders its rows, first the default:
 * the newest suggestions on top, so the latest work is what the list opens
 * on. Highest score and Oldest stay a pick away.
 */
export const OPPORTUNITY_SORTS = ['newest', 'score', 'oldest'] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];
export const DEFAULT_OPPORTUNITY_SORT: OpportunitySort = OPPORTUNITY_SORTS[0];

/**
 * What an opportunity was built for: a group of related prompts in a topic
 * (cluster opportunities, #857), or a single prompt (the older generator).
 */
export type OpportunityScope =
  | { kind: 'group'; count: number; topic: string | null }
  | { kind: 'single' };

export function opportunityScope(
  opp: Pick<ContentOpportunity, 'clusterId' | 'sourceData'>,
): OpportunityScope {
  if (!opp.clusterId) return { kind: 'single' };
  return {
    kind: 'group',
    count: opp.sourceData?.prompts?.length ?? 0,
    topic: opp.sourceData?.topicName ?? null,
  };
}
