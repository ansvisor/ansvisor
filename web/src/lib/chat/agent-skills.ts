/**
 * The skills an agent is made of (CHAT-21 §D step 1) until Chat's skills
 * registry (CHAT-13) lists them: Ansvisor's own skills (Chat agentic plan
 * §4), the governance mockup's ten first, with the connections each one
 * uses (mockup `SK`), which an agent gets as Required. Their titles are
 * chatAgents.skills.{id}. Pure.
 */

export interface AgentSkill {
  /** Its `/command` without the slash, as chat_agent_versions.skill_ids keeps it. */
  id: string;
  /** The connections it uses: Required on an agent that runs it. */
  uses: readonly string[];
}

export const ANSVISOR_SKILLS: readonly AgentSkill[] = [
  { id: 'winback', uses: ['google_search_console', 'webflow'] },
  { id: 'tasks', uses: ['webflow'] },
  { id: 'quality', uses: [] },
  { id: 'faq', uses: [] },
  { id: 'report', uses: ['google_search_console'] },
  { id: 'beat', uses: [] },
  { id: 'refresh', uses: [] },
  { id: 'publish', uses: ['webflow'] },
  { id: 'shopping', uses: ['shopify'] },
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

/** The connections a list of skills uses, in order, once each, with the first skill that does. */
export function skillConnections(skillIds: readonly string[]): { key: string; skill: string }[] {
  const seen = new Set<string>();
  const out: { key: string; skill: string }[] = [];
  for (const id of skillIds) {
    for (const key of skillOf(id)?.uses ?? []) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, skill: id });
    }
  }
  return out;
}
