/**
 * F02 — Fix AI Crawler Accessibility.
 *
 * Signal: Pages AI crawlers are blocked from.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_crawler_access',
  code: 'F02',
  version: 1,
  category: 'fix',
  name: 'Fix AI Crawler Accessibility',
  signalKinds: ['crawler_blocked'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_site_audit',
    'identify_target_pages',
    'fix_crawler_access',
    'validate_technical_fix',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
