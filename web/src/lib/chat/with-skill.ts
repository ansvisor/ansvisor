/**
 * Reads a run makes only within a skill that names them (owner decision
 * 2026-11-09). The query fan-out reads (get_fanouts, get_fanout_gaps) are
 * heavy: picked by the model on Chat Home's questions and other general
 * asks, they timed out. A skill built on them (/fanout, /faq, /create and
 * the others that read fan-outs) names them in its text, or a shortcut's
 * playbook in its reads, so they still run there, an agent's run too (its
 * message loads its skills). Pure.
 */

/** Why a read that runs only within a skill can't run now, or null when it can. */
export function withSkillRefusal(
  tool: { name: string; withSkill?: true },
  loaded: readonly { body: string; reads?: readonly string[] }[],
): { code: 'not_available'; message: string } | null {
  if (!tool.withSkill) return null;
  const named = new RegExp(`\\b${tool.name}\\b`);
  if (loaded.some((skill) => skill.reads?.includes(tool.name) || named.test(skill.body))) {
    return null;
  }
  return {
    code: 'not_available',
    message: `${tool.name} runs only within a loaded skill that uses it, such as /fanout. Answer without it.`,
  };
}
