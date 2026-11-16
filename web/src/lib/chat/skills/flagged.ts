import { adsEnabled } from '@/lib/ads/flag';
import { businessHubEnabled } from '@/lib/business-hub/flag';

/** Ads' skills (ADS-01 §6, Ads Phase 0 PR 15): only with Ads on, as its Chat tools are. */
export const ADS_SKILLS: ReadonlySet<string> = new Set(['earn-or-pay', 'ad-drafts']);

/**
 * Library skills that wait on a feature flag. While its flag is off, a skill
 * is in no list: not the / menu, a run's skills, a schedule, the Skills
 * page, a ready-to-use agent or New agent's pickers. Its name stays the
 * library's (reserved-names.ts), so no workspace skill takes it meanwhile.
 *
 * The flags are read on the server, as they are everywhere else: in the
 * browser each reads off, so a page is handed what the server decided.
 */
const SKILL_FLAGS: Readonly<Record<string, () => boolean>> = {
  // The ChatGPT profile check (ChatGPT Business Hub plan, PR 7): until a person
  // with Business Hub access has checked its pages and field names.
  'chatgpt-profile': businessHubEnabled,
  ...Object.fromEntries([...ADS_SKILLS].map((name) => [name, adsEnabled])),
};

/** Whether this install offers a library skill now: every skill but a flagged one whose flag is off. */
export function skillFlagOn(name: string): boolean {
  return Object.hasOwn(SKILL_FLAGS, name) ? SKILL_FLAGS[name]() : true;
}
