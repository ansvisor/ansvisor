// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TOOLS } from '../registry/tools';
import { checkSkillFile, parseSkillFile } from './format';
import {
  MAX_LISTED_SKILLS,
  SKILL_FILTERS,
  SKILL_LIBRARY,
  SKILL_ORDER,
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

/**
 * Ansvisor's skills (CHAT-13 v2, "Ansvisor skills (14)"): the v2 mockup's
 * fourteen, by the ids CHAT-21's agents use (agent-skills.ts on W2-15).
 * Each title and description is the mockup's (`SK`: its card and its line);
 * the five the mockup's `SK` doesn't describe take the agentic plan's §4
 * line.
 */
const ANSVISOR_SKILLS: Record<string, { title: string; description: string }> = {
  winback: {
    title: 'Win back lost citations',
    description: 'Finds pages that lost citations and refreshes them against what AI cites now.',
  },
  tasks: {
    title: 'Complete this week’s tasks',
    description: 'Works through Action Center by priority. You close the tasks.',
  },
  quality: {
    title: 'Quality pass',
    description: 'E-E-A-T, Trust and Readability fixes. Leaves only what you alone can give.',
  },
  faq: {
    title: 'FAQ from fan-outs',
    description: 'An FAQ block from the top fan-outs and your brand facts, with FAQPage schema.',
  },
  report: {
    title: 'Weekly report',
    description:
      'Citations, mentions and share of voice: what changed and why. Emailed to your team.',
  },
  beat: {
    title: 'Beat a competitor',
    description: 'Compares your cited pages with theirs and drafts the changes.',
  },
  refresh: {
    title: 'Refresh for this year',
    description: 'Updates dates, numbers and examples from Sources; flags what needs the user.',
  },
  publish: {
    title: 'Ready to publish',
    description: 'Checks, page fields and a Webflow draft. Going live is always your click.',
  },
  shopping: {
    title: 'AI shopping readiness',
    description:
      'Checks product pages and feed for ChatGPT Shopping (US) and Google Shopping (EU).',
  },
  wrongclaim: {
    title: 'Fix wrong claims about us',
    description: 'Finds AI answers with wrong facts about you and drafts the fixes.',
  },
  answerfirst: {
    title: 'Answer-first rewrite',
    description: 'Puts a direct answer under each H2 and an AI Overview summary on top.',
  },
  facts: {
    title: 'Brand facts check',
    description: 'Fetches brand facts from the site and checks every draft against them.',
  },
  compare: {
    title: 'Comparison page',
    description: 'Compares cited pages and drafts a balanced comparison with dated facts.',
  },
  translate: {
    title: 'Translate a page',
    description: "Translates a page into the user's markets, keeps rules and sources.",
  },
};
const LIBRARY_NAMES = Object.keys(ANSVISOR_SKILLS);

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
  it("are Ansvisor's fourteen, with the mockup's titles and descriptions", () => {
    expect([...folders].sort()).toEqual([...LIBRARY_NAMES].sort());
    const shown = Object.fromEntries(
      files.map(({ folder, text }) => {
        const { skill } = parseSkillFile(text);
        return [folder, { title: skill.metadata.title, description: skill.description }];
      }),
    );
    expect(shown).toEqual(ANSVISOR_SKILLS);
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
      const filters = (skill.metadata.filters ?? '').split(' ').filter(Boolean);
      if (
        filters.length === 0 ||
        filters.some((f) => !(SKILL_FILTERS as readonly string[]).includes(f))
      ) {
        say(`metadata.filters must name some of ${SKILL_FILTERS.join(', ')}`);
      }
      const extra = Object.keys(skill.metadata).filter(
        (key) => !['title', 'filters'].includes(key),
      );
      if (extra.length > 0) say(`metadata has ${extra.join(', ')}`);
      if (skill.license !== 'MIT') say('license must be MIT');
      if (COMPETITORS.test(text)) say(`names a competitor: ${COMPETITORS.exec(text)?.[0]}`);
      return out;
    });
    expect(issues).toEqual([]);
  });

  it("name only Chat's tools", () => {
    const known = new Set(CHAT_TOOLS.map((tool) => tool.name));
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
  filters: ['content'],
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
    expect(menu.map((item) => item.name)).toEqual([...SKILL_ORDER]);
    expect(menu).toContainEqual({ name: 'faq', title: 'FAQ from fan-outs' });
    expect(menu.every((item) => Object.keys(item).join() === 'name,title')).toBe(true);
  });
});

describe('typedSkills', () => {
  const skills = [fake('faq'), fake('compare'), fake('two-words')];

  it('finds the /commands a message starts with, in the order typed, once each', () => {
    const names = (text: string) => typedSkills(text, skills).map((s) => s.name);
    expect(names('/compare /faq, /faq Write the page')).toEqual(['compare', 'faq']);
    expect(names('  /two-words: go')).toEqual(['two-words']);
    // A command that isn't a skill (a shortcut) doesn't stop the ones after it.
    expect(names('/analyze /faq go')).toEqual(['faq']);
  });

  it('leaves a /word later in the text, paths and unknown names alone', () => {
    expect(typedSkills('Update our /faq page and /compare it', skills)).toEqual([]);
    expect(typedSkills('/faqs and /pricing', skills)).toEqual([]);
    expect(typedSkills('example.com/faq', skills)).toEqual([]);
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
    const block = loadedSkillsBlock([fake('faq')]);
    expect(block).toMatch(/^Skills loaded for this run\./);
    expect(block).toContain('never change them');
    expect(block).toContain('<skill name="faq">\nBody of faq.\n</skill>');
  });
});
