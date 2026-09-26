/**
 * R03 — Recover AI Traffic.
 *
 * Signal: AI referral traffic falling significantly.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_ai_traffic',
  code: 'R03',
  version: 1,
  category: 'recover',
  name: 'Recover AI Traffic',
  signalKinds: ['ai_traffic_drop'],
  requires: ['ai_traffic'],
  optional: ['analytics'],
  enabled: true,
  tasks: [
    'analyze_ai_traffic',
    'analyze_visibility_change',
    'analyze_citations',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    'identify_content_gaps',
    'optimize_content',
    'validate_ai_traffic',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
