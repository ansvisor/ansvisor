/**
 * Fix — pages whose Site Audit score is low enough to be the reason.
 *
 * Requires audits for the same reason the traffic definition requires
 * analytics: without them there is no evidence, and a definition with no
 * possible evidence should not be offered to the brand at all.
 */
export default {
  id: 'fix_low_scores',
  version: 1,
  category: 'fix',
  signalKinds: ['audit_low_score'],
  requires: ['site_audits'],
  optional: [],
  tasks: ['review_audits', 'fix_issues', 'revalidate'],

  payload(byKind) {
    const audit = (byKind.get('audit_low_score') ?? [])[0];
    return { pageCount: Number(audit?.current_value ?? 0) };
  },
};
