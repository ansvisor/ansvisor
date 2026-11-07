import { recommendedPresets, type PresetFit, type PresetViewer } from './agents/catalog';

/**
 * "Agents for you" on Chat Home (AGENTS plan §8 and #11, its new member
 * half; owner decision 2026-11-05): someone new to the workspace sees 3 to
 * 5 ready-to-use agents for the brand's site type and their own work areas,
 * each linked to its card in Agent Center › Ready to use. No agent runs and
 * no AI is used: only the list Ready to use itself orders
 * (recommendedPresets). Turning one on stays the person's click there.
 * Pure.
 */

/** How long after joining the section shows (until hidden sooner). */
export const AGENTS_FOR_YOU_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * When the person joined the workspace: the invitation they accepted to it,
 * else, for whoever made it, when their account was made.
 */
export function joinedAt(
  acceptedAt: string | null | undefined,
  createdAt: string | null | undefined,
): string | null {
  return acceptedAt || createdAt || null;
}

/**
 * Whether the section shows: once the person answered or skipped Your work
 * areas (profiles.work_areas_asked_at), in their first 14 days in the
 * workspace, until they hide it (chat_user_prefs.agents_for_you_dismissed_at).
 */
export function agentsForYouOpen(facts: {
  workAreasAskedAt: string | null;
  joinedAt: string | null;
  dismissedAt: string | null;
  now: number;
}): boolean {
  if (!facts.workAreasAskedAt || facts.dismissedAt || !facts.joinedAt) return false;
  const joined = Date.parse(facts.joinedAt);
  if (Number.isNaN(joined)) return false;
  return facts.now - joined < AGENTS_FOR_YOU_DAYS * DAY_MS;
}

/** One agent the section shows: its preset, and why it fits (null: made for every brand). */
export interface AgentForYou {
  id: string;
  fit: PresetFit | null;
}

/** The agents for the person, in Ready to use's own order for them. */
export function agentsForYou(viewer: PresetViewer): AgentForYou[] {
  return recommendedPresets(viewer).map(({ preset, fit }) => ({ id: preset.id, fit }));
}
