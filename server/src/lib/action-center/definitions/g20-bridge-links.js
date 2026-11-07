/**
 * G20 — Bridge links (AC plan P-10, spec §8).
 *
 * Signal: pages AI sends readers to that rarely convert, each paired with a
 * page that converts and AI sends few readers to (bridge-links.js).
 *
 * One action holds up to five pairs. Its sources are its pages: Start now
 * opens each as an optimize draft with its link in Your input. The plan
 * reads the pairs, adds the links in the editor, and the internal links
 * task checks every source page for its link (task-checks.js). Its tasks
 * are the pairs', so the task writer leaves them as planned.
 */

import { MAX_BRIDGE_PAIRS } from '../bridge-links.js';
import { first, targetPayload } from './_helpers.js';

export const BRIDGE_LINKS_KIND = 'bridge_links';

const address = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

export default {
  id: BRIDGE_LINKS_KIND,
  code: 'G20',
  version: 1,
  category: 'growth',
  name: 'Bridge links',
  signalKinds: ['bridge_link_gap'],
  requires: ['ai_traffic', 'analytics'],
  optional: [],
  enabled: true,
  tasks: [
    'review_link_plan',
    'optimize_content',
    'add_internal_links',
    'validate_ai_traffic',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const signal = first(byKind, 'bridge_link_gap');
    const linkPairs = (signal?.payload?.targets ?? [])
      .filter((target) => address(target?.id) && address(target?.to))
      .slice(0, MAX_BRIDGE_PAIRS)
      .map((target) => ({
        from: target.id,
        to: target.to,
        anchor: target.anchor ?? null,
        reason: target.reason ?? null,
        salesPage: target.salesPage ?? null,
        aiVisits: target.aiVisits ?? 0,
        citations: target.citations ?? 0,
        toSessions: target.toSessions ?? 0,
        toKeyEvents: target.toKeyEvents ?? 0,
        toTransactions: target.toTransactions ?? 0,
      }));
    return targetPayload(byKind, 'pages', {
      // The work is on the sources: their drafts, and what's measured.
      pages: [...new Set(linkPairs.map((pair) => pair.from))],
      linkPairs,
      siteKeyRate: signal?.payload?.siteKeyRate ?? null,
    });
  },
};
