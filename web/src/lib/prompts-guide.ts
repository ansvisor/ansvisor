/**
 * "How to find the best prompts": the Prompts page's guide (the (i) beside
 * its title), ten steps in the approved mockup's order. Each step opens where
 * it's done; a step is ticked only when the brand's data already shows it
 * (getting_started_facts, the read Today's Getting started makes). A step the
 * data can't show is never ticked: there's no manual check-off.
 */

import type { GettingStartedFacts } from '@/lib/getting-started/steps';
import { ADD_TRACKING_HREF } from '@/lib/billing/add-on-links';
import { sectionFor } from '@/lib/prompts-routes';

export type PromptsGuideStepKey =
  | 'gsc'
  | 'ga'
  | 'trafficCode'
  | 'suggestions'
  | 'content'
  | 'optimize'
  | 'audit'
  | 'moreTracking'
  | 'mentions'
  | 'ads';

export interface PromptsGuideStep {
  key: PromptsGuideStepKey;
  /** Where its button goes; null while the step is coming soon (no button). */
  href: string | null;
}

const INTEGRATIONS_HREF = '/dashboard/settings/integrations';

export const PROMPTS_GUIDE_STEPS: readonly PromptsGuideStep[] = [
  { key: 'gsc', href: INTEGRATIONS_HREF },
  { key: 'ga', href: INTEGRATIONS_HREF },
  // AI Traffic has no address that opens its code dialog: its page shows the
  // code's banner itself while the code isn't seen on the site.
  { key: 'trafficCode', href: '/dashboard/traffic' },
  { key: 'suggestions', href: sectionFor('all', 'suggestions').href },
  { key: 'content', href: '/dashboard/content' },
  { key: 'optimize', href: '/dashboard/content/editor' },
  { key: 'audit', href: '/dashboard/audit' },
  { key: 'moreTracking', href: ADD_TRACKING_HREF },
  { key: 'mentions', href: null },
  { key: 'ads', href: null },
];

/**
 * The steps the brand's data shows as done:
 * - Search Console, Analytics: connected and mapped to the brand.
 * - AI traffic code: a visit from an AI assistant was logged.
 * - Suggestions: a prompt tracked from a suggestion, or any active prompt.
 * - Content: content created from a suggestion, or an Editor draft made.
 * - Optimize: an Editor draft of an existing page made ready or published.
 * - Audit: a Site Audit a person ran finished.
 * More tracking and the coming-soon steps aren't shown by the data.
 */
export function promptsGuideDone(facts: GettingStartedFacts | null): Set<PromptsGuideStepKey> {
  const done = new Set<PromptsGuideStepKey>();
  if (!facts) return done;
  if (facts.gsc) done.add('gsc');
  if (facts.ga) done.add('ga');
  if (facts.firstVisit) done.add('trafficCode');
  if (facts.dataTracked > 0 || facts.topicPrompts.some((n) => n > 0)) done.add('suggestions');
  if (facts.contentCreated > 0 || facts.draftsCreated > 0) done.add('content');
  if (facts.draftsOptimized > 0) done.add('optimize');
  if (facts.audits > 0) done.add('audit');
  return done;
}
