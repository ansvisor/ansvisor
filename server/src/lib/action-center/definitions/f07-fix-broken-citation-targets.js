/**
 * F07 — Fix Broken Citation Targets.
 *
 * Signal: Owned URLs AI answers cite that are unavailable.
 *
 * Disabled. Cited owned URLs are not health-checked yet, so there is nothing
 * to detect a broken one from. Registered; enabled once URL checks exist.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_broken_citation_targets',
  code: 'F07',
  version: 1,
  category: 'fix',
  name: 'Fix Broken Citation Targets',
  signalKinds: ['broken_citation_target'],
  requires: ['tracking'],
  optional: [],
  enabled: false,
  disabledReason:
    'Cited owned URLs are not health-checked yet, so there is nothing to detect a broken one from. Registered; enabled once URL checks exist.',
  tasks: [
    'analyze_citations',
    'identify_target_pages',
    'fix_broken_target',
    'validate_technical_fix',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
