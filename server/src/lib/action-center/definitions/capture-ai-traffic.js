/**
 * Growth — pages already earning traffic that AI answers do not cite.
 *
 * The only definition whose evidence comes from outside our own tracking:
 * page opportunities are landing pages read from the brand's analytics
 * connection, so without one the definition has nothing to stand on.
 */
export default {
  id: 'capture_ai_traffic',
  version: 1,
  category: 'growth',
  signalKinds: ['page_opportunity'],
  requires: ['analytics'],
  optional: ['site_audits'],
  tasks: ['review_pages', 'coverage_gaps', 'optimize_content', 'validate'],

  payload(byKind) {
    return { pageCount: (byKind.get('page_opportunity') ?? []).length };
  },
};
