import library from './library.json';
import { SHORTCUT_IDS } from '../shortcuts';

/**
 * The names a workspace skill never takes: the library's (its /command
 * would be two), and the / menu's shortcuts' (W2-09), each a hidden library
 * skill under its /command. Pure: the skill card reads it as the person
 * types (W3-08), the store when it saves.
 */
export const RESERVED_SKILL_NAMES: ReadonlySet<string> = new Set([
  ...(library as { skills: { name: string }[] }).skills.map((skill) => skill.name),
  ...SHORTCUT_IDS,
]);
