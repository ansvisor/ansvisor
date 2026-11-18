import { adsEnabled } from '@/lib/ads/flag';
import { businessHubEnabled } from '@/lib/business-hub/flag';
import { chatOperatorOn } from '../flag';

/** Ads' skills (ADS-01 §6, Ads Phase 0 PR 15): only with Ads on, as its Chat tools are. */
export const ADS_SKILLS: ReadonlySet<string> = new Set(['earn-or-pay', 'ad-drafts']);

/**
 * Library skills that wait on a feature flag. While its flag is off, a skill
 * is in no list: not the / menu, a run's skills, a schedule, the Skills
 * page, a ready-to-use agent or New agent's pickers. Its name stays the
 * library's (reserved-names.ts), so no workspace skill takes it meanwhile.
 *
 * The flags are read on the server, as they are everywhere else: in the
 * browser each reads off, so a page is handed what the server decided. A
 * flag that names workspaces (CHAT_OPERATOR_ORGS) is asked about the
 * workspace when there is one; with none (the install's lists), whether it
 * is on at all.
 */
const SKILL_FLAGS: Readonly<Record<string, (organizationId?: string | null) => boolean>> = {
  // The ChatGPT profile check (ChatGPT Business Hub plan, PR 7): until a person
  // with Business Hub access has checked its pages and field names.
  'chatgpt-profile': businessHubEnabled,
  ...Object.fromEntries([...ADS_SKILLS].map((name) => [name, adsEnabled])),
  // The AEO Operator's own skill (AEO Operator plan §4.5): CHAT_OPERATOR, for its workspaces.
  operator: chatOperatorOn,
};

/**
 * Whether this install offers a library skill now: every skill but a flagged
 * one whose flag is off; for a workspace, off for it.
 */
export function skillFlagOn(name: string, organizationId?: string | null): boolean {
  return Object.hasOwn(SKILL_FLAGS, name) ? SKILL_FLAGS[name](organizationId) : true;
}
