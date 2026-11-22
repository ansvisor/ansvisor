/**
 * F15 — Review Paid Overlap (Ads Phase 1 P4).
 *
 * Signal: buying-intent prompts AI already picks the brand for, where its
 * Google spend on the matched search terms is rising (lib/ads/paid-watch.js).
 * The person checks in their own Google Ads account whether those terms
 * still need the ad, for example with a lower bid or a short test pause,
 * while the brand keeps the AI answer. Ansvisor changes nothing in an ad
 * account.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'review_paid_overlap',
  code: 'F15',
  version: 1,
  category: 'fix',
  name: 'Review Paid Overlap',
  signalKinds: ['paid_overlap'],
  requires: ['google_ads'],
  optional: [],
  enabled: true,
  tasks: ['review_paid_overlap', 'validate_ai_visibility', 'measure_action_outcome'],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
