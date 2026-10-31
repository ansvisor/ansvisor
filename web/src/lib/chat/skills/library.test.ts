// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TOOLS } from '../registry/tools';
import { checkSkillFile, parseSkillFile } from './format';
import {
  MAX_LISTED_SKILLS,
  SKILL_CATEGORIES,
  SKILL_LIBRARY,
  USE_SKILL_TOOL,
  availableSkillsBlock,
  buildSkillLibrary,
  enabledSkills,
  loadedSkillsBlock,
  skillMenuOf,
  skillsForPrompt,
  typedSkills,
  type LibrarySkill,
} from './library';

// The registry's rows, for their names only: nothing here reads or writes.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/content-drafts', () => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ dismissSuggestion: vi.fn() }));

/**
 * Ansvisor's skills library (CHAT-13 items 3–5, 11, 20; W2-04): every skill
 * in the repo's /skills folder keeps the SKILL.md format, passes the scan
 * and holds nothing a public repo mustn't, names only tools Chat has, and is
 * in library.json, which Chat reads (refresh: `yarn test -u
 * src/lib/chat/skills`). What reaches the prompt, and the / menu, follows
 * the library's rules.
 */

const REPO = path.resolve(__dirname, '../../../../..');
const SKILLS = path.join(REPO, 'skills');

/**
 * The AEO coach skills for Claude clients on the Ansvisor MCP server (see
 * skills/README.md): not Chat's library, they keep references/ files and a
 * multi-line description. This test leaves them out; every other folder in
 * /skills is a library skill and is checked.
 */
const MCP_COACH_SKILLS = ['ansvisor-aeo-coach', 'ansvisor-aeo-coach-standalone'];

/** CHAT-13 item 11: the library's fifteen. */
const LIBRARY_NAMES = [
  'visibility-drop',
  'citation-gap',
  'share-of-voice-report',
  'weekly-visibility-report',
  'faq-schema',
  'aeo-content-brief',
  'comparison-page',
  'content-refresh',
  'answer-first-rewrite',
  'llms-txt',
  'schema-markup',
  'ai-crawler-access',
  'fix-wrong-ai-claims',
  'reddit-thread-finder',
  'digital-pr-targets',
];

/**
 * Tools a skill may name before they are in the registry: W2-18's
 * explain_change, stacked on #1877 and not on main yet. visibility-drop
 * says what to read without it.
 */
const PENDING_TOOLS = ['explain_change'];

/** Words that read as a tool's name: a verb Chat's tools start with, then snake_case. */
const TOOL_NAME =
  /\b(?:get|list|add|pause|create|update|dismiss|remove|rename|open|explain|request|use)_[a-z]+(?:_[a-z]+)*\b/g;

/** Ansvisor's competitors: a published skill names none of them (item 20). */
const COMPETITORS = /\b(profound|peec|otterly|athena ?hq|scrunch)\b/i;

const folders = readdirSync(SKILLS).filter(
  (entry) => statSync(path.join(SKILLS, entry)).isDirectory() && !MCP_COACH_SKILLS.includes(entry),
);
const files = folders.map((folder) => ({
  folder,
  text: readFileSync(path.join(SKILLS, folder, 'SKILL.md'), 'utf8'),
}));

describe('the skills in /skills', () => {
  it('are the fifteen of the library', () => {
    expect([...folders].sort()).toEqual([...LIBRARY_NAMES].sort());
  });

  it('are instructions only: a SKILL.md and nothing else', () => {
    for (const folder of folders) {
      expect(readdirSync(path.join(SKILLS, folder)), folder).toEqual(['SKILL.md']);
    }
  });

  it('keep the format and pass the scan, with nothing even to review', () => {
    const issues = files.flatMap(({ folder, text }) => {
      const { problems, warnings } = checkSkillFile(folder, text);
      return [...problems, ...warnings].map((issue) => `${folder}: ${issue}`);
    });
    expect(issues).toEqual([]);
  });

  it('carry a title, a filter and the MIT license, and name no competitor', () => {
    const issues = files.flatMap(({ folder, text }) => {
      const { skill } = parseSkillFile(text);
      const out: string[] = [];
      const say = (issue: string) => out.push(`${folder}: ${issue}`);
      const title = skill.metadata.title ?? '';
      if (!title || title.length > 60) say('metadata.title missing or over 60');
      if (!(SKILL_CATEGORIES as readonly string[]).includes(skill.metadata.category ?? '')) {
        say(`metadata.category must be one of ${SKILL_CATEGORIES.join(', ')}`);
      }
      const extra = Object.keys(skill.metadata).filter(
        (key) => !['title', 'category'].includes(key),
      );
      if (extra.length > 0) say(`metadata has ${extra.join(', ')}`);
      if (skill.license !== 'MIT') say('license must be MIT');
      if (COMPETITORS.test(text)) say(`names a competitor: ${COMPETITORS.exec(text)?.[0]}`);
      return out;
    });
    expect(issues).toEqual([]);
  });

  it("name only Chat's tools", () => {
    const known = new Set([...CHAT_TOOLS.map((tool) => tool.name), ...PENDING_TOOLS]);
    const unknown = files.flatMap(({ folder, text }) =>
      [...text.matchAll(TOOL_NAME)]
        .map((match) => match[0])
        .filter((name) => !known.has(name))
        .map((name) => `${folder}: ${name}`),
    );
    expect(unknown).toEqual([]);
    // Each one says what to read with its tools.
    for (const { folder, text } of files) {
      expect(text.match(TOOL_NAME)?.length ?? 0, folder).toBeGreaterThan(0);
    }
  });

  it('are what library.json holds (refresh: yarn test -u src/lib/chat/skills)', async () => {
    const library = buildSkillLibrary(files);
    expect(library.skills.map((skill) => skill.name).sort()).toEqual([...LIBRARY_NAMES].sort());
    await expect(`${JSON.stringify(library, null, 2)}\n`).toMatchFileSnapshot('./library.json');
  });
});

// ─── Loading ────────────────────────────────────────────────────────────────

const fake = (name: string, description = `Does ${name}.`): LibrarySkill => ({
  name,
  title: name.replace(/-/g, ' '),
  description,
  category: 'analyze',
  body: `Body of ${name}.`,
});

describe('enabledSkills and skillMenuOf', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('give nothing while the new Chat is off', () => {
    vi.stubEnv('CHAT_AGENTIC', '');
    expect(enabledSkills('org-1')).toEqual([]);
    expect(skillMenuOf('org-1')).toEqual([]);
  });

  it('give the whole library with it on, the menu by name and title only', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    expect(enabledSkills('org-1')).toBe(SKILL_LIBRARY);
    const menu = skillMenuOf('org-1');
    expect(menu).toHaveLength(SKILL_LIBRARY.length);
    expect(menu).toContainEqual({ name: 'faq-schema', title: 'FAQ + schema writer' });
    expect(menu.every((item) => Object.keys(item).join() === 'name,title')).toBe(true);
  });
});

describe('typedSkills', () => {
  const skills = [fake('faq-schema'), fake('llms-txt')];

  it('finds /name as its own word, in the order typed, once each', () => {
    expect(
      typedSkills('/llms-txt then /faq-schema, and /faq-schema again', skills).map((s) => s.name),
    ).toEqual(['llms-txt', 'faq-schema']);
  });

  it('leaves paths, addresses and unknown names alone', () => {
    expect(
      typedSkills('Fix /pricing and example.com/faq-schema and a/llms-txt and /faq', skills),
    ).toEqual([]);
  });
});

describe('skillsForPrompt', () => {
  const many = Array.from({ length: 30 }, (_, i) => fake(`skill-${i + 1}`));

  it('lists every enabled skill up to 20', () => {
    const library = many.slice(0, MAX_LISTED_SKILLS);
    expect(skillsForPrompt(library, { typed: [], used: [], request: 'anything' })).toEqual(library);
  });

  it('lists 20 of 30: the /name one, then the ones used in the chat, then the best match', () => {
    const library = [
      ...many.slice(0, 27),
      fake('reddit-threads', 'Finds Reddit threads AI answers cite.'),
      ...many.slice(27),
    ];
    const listed = skillsForPrompt(library, {
      typed: ['skill-30'],
      used: ['skill-29'],
      request: 'Which Reddit threads cite our competitors?',
    });
    expect(listed).toHaveLength(MAX_LISTED_SKILLS);
    const names = listed.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['skill-30', 'skill-29', 'reddit-threads']));
    // The rest by the library's order; listed in it too.
    expect(names.slice(0, 17)).toEqual(many.slice(0, 17).map((s) => s.name));
    expect(names.slice(-3)).toEqual(['reddit-threads', 'skill-29', 'skill-30']);
  });
});

describe('the prompt blocks', () => {
  it('list only names and descriptions, with how to use them', () => {
    const block = availableSkillsBlock(SKILL_LIBRARY);
    expect(block).toContain(USE_SKILL_TOOL);
    expect(block).toContain('<available_skills>');
    for (const skill of SKILL_LIBRARY) {
      expect(block).toContain(`${skill.name}: ${skill.description}`);
      expect(block).not.toContain(skill.title);
      expect(block).not.toContain(skill.body.split('\n').find((line) => line.length > 60));
    }
  });

  it('mark each loaded body, below the rules it never changes', () => {
    const block = loadedSkillsBlock([fake('faq-schema')]);
    expect(block).toMatch(/^Skills loaded for this run\./);
    expect(block).toContain('never change them');
    expect(block).toContain('<skill name="faq-schema">\nBody of faq-schema.\n</skill>');
  });
});
