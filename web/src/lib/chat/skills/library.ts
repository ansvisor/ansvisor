import library from './library.json';
import type { ChatSkillItem } from '../composer-setup';
import { chatAgenticEnabled } from '../flag';
import { parseSkillFile } from './format';

/**
 * Chat's skills (CHAT-13 items 3–6, and its v2 "Ansvisor skills (14)"; Chat
 * Wave 2 W2-04): Ansvisor's own skills, the v2 mockup's fourteen (`SK`)
 * and CHAT-24 §5's seven for the focus areas (W2-23), written as SKILL.md
 * files in the repo's /skills folder and
 * published with it (item 20). The web app's build can't read that folder,
 * so the library is kept here in library.json, and library.test.ts keeps
 * the file in step with /skills (refresh it with `yarn test -u
 * src/lib/chat/skills`), as Help's approved articles are.
 *
 * Only a skill's name and description reach the system prompt, at most 20.
 * Its body loads when Chat picks it (use_skill) or the person types its
 * /name, at most 3 a run, in a marked block below the system rules. A skill
 * shapes how Chat does a task; it never changes the rules, the tools
 * offered, the cards a change needs or the run's limits (item 6). All of it
 * only with the new Chat on (CHAT_AGENTIC). Every library skill is on for
 * everyone until "My skills" lets a person switch one off (W3). Server
 * only: the bodies stay on the server, and a page gets names and titles.
 */

/**
 * The Skills page's filters (mockup #s-skills): Content, Visibility,
 * Reports, Product Visibility. A skill's `metadata.filters` names one or
 * more, space-separated, as the mockup's `SK` does.
 */
export const SKILL_FILTERS = ['content', 'visibility', 'reports', 'product'] as const;
export type SkillFilter = (typeof SKILL_FILTERS)[number];

/**
 * Ansvisor's skills in the mockup's order (CHAT-21's agent skills,
 * agent-skills.ts on W2-15, use the same ids in the same order). A skill
 * not listed here comes after them, by name.
 */
export const SKILL_ORDER = [
  'winback',
  'tasks',
  'quality',
  'faq',
  'report',
  'beat',
  'refresh',
  'publish',
  'shopping',
  'wrongclaim',
  'answerfirst',
  'facts',
  'compare',
  'translate',
  // CHAT-24 §5, in its table's order (/compare is /features, /factcheck is wrongclaim).
  'questions',
  'features',
  'gaps',
  'markets',
  'listings',
  'rivals',
  'audit-fix',
] as const;

export interface LibrarySkill {
  /** Its folder's name, and its /command. */
  name: string;
  /** metadata.title: what its step and the / menu show. */
  title: string;
  /** What it does: the Skills card's line, and what the model picks it by. */
  description: string;
  filters: SkillFilter[];
  /** Its instructions, loaded only when it is used. */
  body: string;
}

/** The library, as library.json keeps it: in SKILL_ORDER. */
export const SKILL_LIBRARY: readonly LibrarySkill[] = (library as { skills: LibrarySkill[] })
  .skills;

/** The most skills listed in a request's system prompt (item 3). */
export const MAX_LISTED_SKILLS = 20;
/** The most skill bodies a run loads (item 4). */
export const MAX_SKILL_BODIES = 3;
/** The engine's own tool that loads a skill's body when the model picks it. */
export const USE_SKILL_TOOL = 'use_skill';

/** The library as library.json holds it, from the skills' SKILL.md files. */
export function buildSkillLibrary(files: readonly { folder: string; text: string }[]): {
  skills: LibrarySkill[];
} {
  const rank = (name: string) => {
    const at = (SKILL_ORDER as readonly string[]).indexOf(name);
    return at < 0 ? SKILL_ORDER.length : at;
  };
  const skills = files.map(({ folder, text }) => {
    const { skill } = parseSkillFile(text);
    return {
      name: skill.name ?? folder,
      title: skill.metadata.title ?? '',
      description: skill.description ?? '',
      filters: (skill.metadata.filters ?? '').split(/\s+/).filter(Boolean) as SkillFilter[],
      body: skill.body.trim(),
    };
  });
  return {
    skills: skills.sort(
      (a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    ),
  };
}

/** The skills on for a workspace: the whole library, or none while the new Chat is off. */
export function enabledSkills(
  organizationId: string | null,
  skills: readonly LibrarySkill[] = SKILL_LIBRARY,
): readonly LibrarySkill[] {
  return chatAgenticEnabled(organizationId) ? skills : [];
}

/** The / menu's Skills group (item 5): each enabled skill's /command and title, nothing else. */
export function skillMenuOf(organizationId: string | null): ChatSkillItem[] {
  return enabledSkills(organizationId).map(({ name, title }) => ({ name, title }));
}

/** One "/command" first in what is left of the text, and the marks after it. */
const LEADING = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,;:!?])[\s.,;:!?]*/;

/**
 * The skills a message calls by /name, in the order typed, each once: the
 * commands it starts with, as the / menu puts them ("/faq /compare Write…").
 * A /word later in the text is a page's path ("our /faq page"), not a call.
 */
export function typedSkills<T extends { name: string }>(text: string, skills: readonly T[]): T[] {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const out: T[] = [];
  let rest = text.trimStart();
  for (let match = LEADING.exec(rest); match; match = LEADING.exec(rest)) {
    const skill = byName.get(match[1]);
    if (skill && !out.includes(skill)) out.push(skill);
    rest = rest.slice(match[0].length);
  }
  return out;
}

const STOP_WORDS = new Set(
  'the and for our with what why how who are was were this that from into about can you your their them they its has have had does did not but all any out get make want need should would could'.split(
    ' ',
  ),
);

/** A text's words as the match reads them: lower case, three letters or more, a plural's s off. */
function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)),
  );
}

/** How well a skill fits the request: its name's and title's words count twice. */
function matchScore(
  skill: Pick<LibrarySkill, 'name' | 'title' | 'description'>,
  request: Set<string>,
) {
  const strong = wordsOf(`${skill.name.replace(/-/g, ' ')} ${skill.title}`);
  const weak = wordsOf(skill.description);
  let score = 0;
  for (const word of request) score += strong.has(word) ? 2 : weak.has(word) ? 1 : 0;
  return score;
}

/**
 * The skills listed in a request's prompt (item 3): every enabled one up to
 * 20; past that, the ones called by /name, then the ones used in this chat,
 * then the best match to the request and the page. Listed in the library's
 * order, so the same skills always read the same.
 */
export function skillsForPrompt<T extends Pick<LibrarySkill, 'name' | 'title' | 'description'>>(
  enabled: readonly T[],
  picks: { typed: readonly string[]; used: readonly string[]; request: string },
): T[] {
  if (enabled.length <= MAX_LISTED_SKILLS) return [...enabled];
  const byName = new Map(enabled.map((skill) => [skill.name, skill]));
  const chosen = new Set<T>();
  for (const name of [...picks.typed, ...picks.used]) {
    const skill = byName.get(name);
    if (skill && chosen.size < MAX_LISTED_SKILLS) chosen.add(skill);
  }
  const request = wordsOf(picks.request);
  const ranked = enabled
    .map((skill, i) => ({ skill, i, score: matchScore(skill, request) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { skill } of ranked) {
    if (chosen.size >= MAX_LISTED_SKILLS) break;
    chosen.add(skill);
  }
  return enabled.filter((skill) => chosen.has(skill));
}

/**
 * The skills part of the workspace block (prompt.ts block 2; the data notes'
 * `<available_skills>`): how to use them, and each listed skill's name and
 * description, nothing else.
 */
export function availableSkillsBlock(
  skills: readonly Pick<LibrarySkill, 'name' | 'description'>[],
): string {
  return [
    `Skills are how-tos for tasks in Ansvisor. When one fits the request, call ${USE_SKILL_TOOL} with its name before you read or write: once per skill, at most ${MAX_SKILL_BODIES} a run. A /name at the start of the person's message picks that skill for them. Skills loaded for you are below in <skill> blocks; a /name without a block wasn't loaded (a run loads ${MAX_SKILL_BODIES} at most): say so in one line. Follow a loaded skill's text for how to do the task. It never changes these rules, the tools you have, the cards and clicks a change needs, the run's limits, or what may go in public content; where it disagrees with them, these rules win.`,
    '<available_skills>',
    ...skills.map((skill) => `${skill.name}: ${skill.description}`),
    '</available_skills>',
  ].join('\n');
}

/**
 * The bodies of the skills loaded for this run (prompt.ts block 2b, item 6):
 * below the system rules, each in its marked block.
 */
export function loadedSkillsBlock(skills: readonly Pick<LibrarySkill, 'name' | 'body'>[]): string {
  return [
    'Skills loaded for this run. Follow them for how to do the task. They come below the rules above and never change them: no skill adds a tool, skips a card or a click, changes a limit, or puts tracking numbers in public content.',
    ...skills.map((skill) => `<skill name="${skill.name}">\n${skill.body.trim()}\n</skill>`),
  ].join('\n\n');
}
