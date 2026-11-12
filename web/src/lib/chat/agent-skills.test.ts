import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { ANSVISOR_SKILLS, requiredBy, skillConnections, skillOf } from './agent-skills';
import { SKILL_LIBRARY, SKILL_ORDER } from './skills/library';

/**
 * The skills an agent is made of (CHAT-21 §D step 1): every skill in Chat's
 * library, the fourteen, the focus areas' seven (W2-23b), then /setup (the
 * Onboarding & Help agent's), /fanout (the Fan-out Gap Filler's) and /prompts
 * (the Prompt Portfolio Manager's), in its order, each titled as its
 * SKILL.md, with the connections it uses.
 */

const FOCUS_SKILLS = [
  'questions',
  'features',
  'gaps',
  'markets',
  'listings',
  'rivals',
  'audit-fix',
];

describe('ANSVISOR_SKILLS', () => {
  it("lists every library skill, in the library's order, the focus areas' seven, the AGENTS plan's three, then /plan", () => {
    expect(ANSVISOR_SKILLS.map((skill) => skill.id)).toEqual([...SKILL_ORDER]);
    // The fourteen and /chatgpt-profile (after /facts, ChatGPT Business Hub plan PR 7), then the seven.
    expect(ANSVISOR_SKILLS.slice(15, 22).map((skill) => skill.id)).toEqual(FOCUS_SKILLS);
    expect(ANSVISOR_SKILLS.slice(-4).map((skill) => skill.id)).toEqual([
      'setup',
      'fanout',
      'prompts',
      'plan',
    ]);
  });

  it('titles each skill as its SKILL.md does', () => {
    const titles = messages.chatAgents.skills as Record<string, string>;
    for (const skill of SKILL_LIBRARY) {
      expect(titles[skill.name], skill.name).toBe(skill.title);
    }
    expect(Object.keys(titles).sort()).toEqual(ANSVISOR_SKILLS.map((skill) => skill.id).sort());
  });

  it('gives /chatgpt-profile no connection: it reads answers, facts and the brand’s pages, and saves drafts', () => {
    expect(skillOf('chatgpt-profile')?.uses).toEqual([]);
  });

  it('gives /setup no connection: it says how to connect one, and reads Ansvisor’s own data', () => {
    expect(skillOf('setup')?.uses).toEqual([]);
  });

  it('gives /fanout no connection: it reads the brand’s own fan-outs and saves drafts', () => {
    expect(skillOf('fanout')?.uses).toEqual([]);
  });

  it('gives /prompts Search Console as Optional: it reads the queries when connected', () => {
    expect(skillConnections(['prompts'])).toEqual([
      { key: 'google_search_console', skill: 'prompts', required: false },
    ]);
    expect(requiredBy(['prompts'], 'google_search_console')).toBeNull();
  });

  it("gives the focus areas' seven no connection: they read Ansvisor's own data", () => {
    for (const id of FOCUS_SKILLS) expect(skillOf(id)?.uses, id).toEqual([]);
    expect(skillConnections(FOCUS_SKILLS)).toEqual([]);
    expect(requiredBy(FOCUS_SKILLS, 'catalog')).toBeNull();
  });

  it('adds what a follow-on skill needs, Required by the one that sends the page', () => {
    expect(skillConnections(['audit-fix', 'publish'])).toEqual([
      { key: 'cms', skill: 'publish', required: true },
    ]);
    expect(skillConnections(['questions', 'report'])).toEqual([
      { key: 'google_search_console', skill: 'report', required: false },
    ]);
    expect(requiredBy(['listings', 'shopping'], 'catalog')).toBe('shopping');
  });
});
