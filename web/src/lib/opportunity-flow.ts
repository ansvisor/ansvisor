/**
 * Why the nightly run adds no new opportunities, for the note above the
 * Content Opportunities list. Each need (prompt cluster) gets one opportunity
 * (server/src/lib/opportunity-limits.js), and new ones take a slot of the
 * month's quota, so the list stops growing in two cases: the month's
 * opportunities are used up, or every need with answers has its opportunity.
 */

/** The month's quota is used up, or no need is left without an opportunity. */
export type OpportunityFlowState = 'limit' | 'allCovered';

export function opportunityFlowState({
  limitReached,
  needs,
}: {
  limitReached: boolean;
  /** From getOpportunityAvailability; null while unread or when it failed. */
  needs: { needs: number; open: number } | null;
}): OpportunityFlowState | null {
  if (limitReached) return 'limit';
  if (needs && needs.needs > 0 && needs.open === 0) return 'allCovered';
  return null;
}
