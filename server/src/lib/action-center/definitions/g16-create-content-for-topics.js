/**
 * G16 — Create Content for Topic Gaps.
 *
 * Signal: A relevant topic the brand barely appears in.
 *
 * Version 2 (AC plan P-7): a new page, as before, unless the action is a
 * store's whose topic has a live category page (generate.js, category
 * play): that page is optimized instead (`contentExists`).
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'create_content_for_topics',
  code: 'G16',
  version: 2,
  category: 'growth',
  name: 'Create Content for Topic Gaps',
  signalKinds: ['topic_uncovered'],
  requires: ['tracking', 'topics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_topic_gap',
    {
      branch: [
        ['optimize_content'],
        [
          'cluster_prompts',
          'identify_new_content_need',
          'create_content_brief',
          'create_content_draft',
        ],
      ],
    },
    'add_internal_links',
    'publish_content',
    'validate_topic_sov',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'topic_uncovered');
    // A new page unless a category page is found for it (the category play).
    return {
      ...targetPayload(byKind, 'topics'),
      topicName: lead?.payload?.topicName,
      contentExists: false,
    };
  },
};
