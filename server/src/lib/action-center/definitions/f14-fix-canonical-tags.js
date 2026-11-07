/**
 * F14 — Fix Canonical Tags (AC plan P-11, spec §9).
 *
 * Signal: audited pages whose canonical tag is missing, or points to
 * another site, a redirect, a noindex page or a page that isn't there
 * (audit/canonical.js). The audit's score counts only the tag's presence;
 * this is where the rest becomes work.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_canonical_tags',
  code: 'F14',
  version: 1,
  category: 'fix',
  name: 'Fix Canonical Tags',
  signalKinds: ['canonical_issue'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_site_audit',
    'fix_canonical',
    'validate_technical_fix',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
