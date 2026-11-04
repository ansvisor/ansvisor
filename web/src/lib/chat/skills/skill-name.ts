import { MAX_NAME, SKILL_NAME } from './format';
import { RESERVED_SKILL_NAMES } from './reserved-names';

/** Why a skill's /name can't be kept, as a chatSkills.card key; null when it can. */
export type SkillNameProblem = 'nameRequired' | 'nameFormat' | 'nameReserved';

/**
 * A /name as a skill's draft card keeps it (W3-08): without its slash,
 * trimmed, lowercase, and why it can't be kept: the format (format.ts
 * SKILL_NAME), and never an Ansvisor skill's nor a shortcut's name
 * (reserved-names.ts). The card says it as the person types; save_skill's
 * apply says it again on Save, and the store checks it once more. Pure.
 */
export function readSkillName(raw: string): { name: string; problem: SkillNameProblem | null } {
  const name = raw.trim().replace(/^\//, '').toLowerCase();
  if (!name) return { name, problem: 'nameRequired' };
  if (name.length > MAX_NAME || !SKILL_NAME.test(name)) return { name, problem: 'nameFormat' };
  if (RESERVED_SKILL_NAMES.has(name)) return { name, problem: 'nameReserved' };
  return { name, problem: null };
}
