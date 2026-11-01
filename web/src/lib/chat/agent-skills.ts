/**
 * The skills an agent is made of (CHAT-21 §D step 1) until Chat's skills
 * registry (CHAT-13) lists them: Ansvisor's own skills (Chat agentic plan
 * §4), the governance mockup's ten first, with the connections each one
 * uses, Required or Optional (§D step 4). Their titles are
 * chatAgents.skills.{id}. Pure.
 *
 * A connection is a kind, never one product: `cms` is any CMS the brand
 * sends pages to (Webflow, WordPress, Framer, Wix or a workflow webhook),
 * `catalog` any source of its product catalog (Merchant Center, a feed, a
 * store). Only what a skill can't work without is Required: /publish sends
 * the page, /shopping reads the catalog. /winback and /tasks write their
 * drafts without a CMS, and /report and /winback read without Search
 * Console: those are Optional, and a run without them does the rest
 * (§H item 42).
 */

/** A connection a skill uses, and whether it can't work without it. */
export interface SkillConnection {
  key: string;
  required: boolean;
}

export interface AgentSkill {
  /** Its `/command` without the slash, as chat_agent_versions.skill_ids keeps it. */
  id: string;
  /** The connections it uses: an agent that runs it gets them, Required or Optional as here. */
  uses: readonly SkillConnection[];
}

/** Any CMS the brand sends pages to. */
export const CMS_CONNECTION = 'cms';
/** Any source of the brand's product catalog. */
export const CATALOG_CONNECTION = 'catalog';

const optional = (key: string): SkillConnection => ({ key, required: false });
const required = (key: string): SkillConnection => ({ key, required: true });

export const ANSVISOR_SKILLS: readonly AgentSkill[] = [
  { id: 'winback', uses: [optional('google_search_console'), optional(CMS_CONNECTION)] },
  { id: 'tasks', uses: [optional(CMS_CONNECTION)] },
  { id: 'quality', uses: [] },
  { id: 'faq', uses: [] },
  { id: 'report', uses: [optional('google_search_console')] },
  { id: 'beat', uses: [] },
  { id: 'refresh', uses: [] },
  { id: 'publish', uses: [required(CMS_CONNECTION)] },
  { id: 'shopping', uses: [required(CATALOG_CONNECTION)] },
  { id: 'wrongclaim', uses: [] },
  { id: 'answerfirst', uses: [] },
  { id: 'facts', uses: [] },
  { id: 'compare', uses: [] },
  { id: 'translate', uses: [] },
];

/** Connections any agent may add as Optional (mockup: Google Analytics). */
export const OPTIONAL_CONNECTIONS: readonly string[] = ['google_analytics'];

/** Follow-on skills an agent may add after its primary one (§D step 1). */
export const MAX_FOLLOW_ON_SKILLS = 2;

export function skillOf(id: string): AgentSkill | null {
  return ANSVISOR_SKILLS.find((skill) => skill.id === id) ?? null;
}

/**
 * The connections a list of skills uses, in order, once each: Required when
 * one of the skills can't work without it, with the skill that needs it
 * (else the first that uses it).
 */
export function skillConnections(
  skillIds: readonly string[],
): { key: string; skill: string; required: boolean }[] {
  const out: { key: string; skill: string; required: boolean }[] = [];
  for (const id of skillIds) {
    for (const use of skillOf(id)?.uses ?? []) {
      const seen = out.find((c) => c.key === use.key);
      if (!seen) out.push({ key: use.key, skill: id, required: use.required });
      else if (use.required && !seen.required) Object.assign(seen, { skill: id, required: true });
    }
  }
  return out;
}

/** The skill of a list that needs a connection (its "Required by /…"), or null. */
export function requiredBy(skillIds: readonly string[], key: string): string | null {
  return (
    skillIds.find((id) => skillOf(id)?.uses.some((use) => use.key === key && use.required)) ?? null
  );
}
