/**
 * Compete — a competitor is cited far more often than the brand.
 *
 * Distinct from close_competitor_gap, which is about visibility: this one is
 * about who gets referenced, and the work is earning sources rather than
 * ranking answers.
 */
export default {
  id: 'close_citation_gap',
  version: 1,
  category: 'compete',
  signalKinds: ['competitor_citation_gap'],
  requires: ['tracking', 'competitors'],
  optional: [],
  tasks: ['compare_citations', 'identify_sources', 'strengthen_sources', 'validate'],

  payload(byKind) {
    const gap = (byKind.get('competitor_citation_gap') ?? [])[0];
    if (!gap) return {};
    return {
      competitorNames: gap.payload?.competitorName ? [gap.payload.competitorName] : [],
      citationCount: gap.current_value,
      competitorCitations: gap.payload?.competitorCitations,
    };
  },
};
