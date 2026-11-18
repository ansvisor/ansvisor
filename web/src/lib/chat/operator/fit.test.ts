// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_CATEGORIES } from '@/lib/action-center/registry';
import { KPI_KEYS } from '@/lib/kpis/registry';
import { SIGNAL_CATEGORIES } from '@/lib/signals/registry';
import { ANSVISOR_SKILLS } from '../agent-skills';
import library from '../skills/library.json';
import { OPERATOR_SKILL } from './defaults';
import { SKILL_FIT, UNMAPPED_SKILLS, agentFit, skillFit } from './fit';

/**
 * Which agent fits which work (AEO Operator plan §4.2): every skill of the
 * library is mapped to the work it serves or left out on purpose, never
 * both and never forgotten: the repo's /skills folder, library.json's
 * skills and playbooks, the agents' skills (agent-skills.ts) and the
 * presets'. A new skill fails here until it is placed.
 */

const REPO = path.resolve(__dirname, '../../../../..');
const SKILLS = path.join(REPO, 'skills');
const PRESETS = path.join(__dirname, '../agents/presets');

const folders = readdirSync(SKILLS).filter((entry) =>
  statSync(path.join(SKILLS, entry)).isDirectory(),
);
const presetSkills = readdirSync(PRESETS)
  .filter((file) => file.endsWith('.json'))
  .flatMap(
    (file) =>
      (JSON.parse(readFileSync(path.join(PRESETS, file), 'utf8')) as { skills: string[] }).skills,
  );
const librarySkills = [
  ...library.skills.map((skill) => skill.name),
  ...library.playbooks.map((skill) => skill.name),
];
const everySkill = [
  ...new Set([
    ...folders,
    ...librarySkills,
    ...ANSVISOR_SKILLS.map((skill) => skill.id),
    ...presetSkills,
  ]),
].sort();

describe('the skills’ fit', () => {
  it('reads a library to check', () => {
    // The folder, the library and the presets all list skills: the lists below aren't empty.
    expect(folders.length).toBeGreaterThan(30);
    expect(presetSkills.length).toBeGreaterThan(20);
  });

  it.each(everySkill)('places /%s: mapped or left out on purpose', (id) => {
    const mapped = Object.hasOwn(SKILL_FIT, id);
    const unmapped = Object.hasOwn(UNMAPPED_SKILLS, id);
    expect(mapped || unmapped, `${id} is neither mapped nor left out`).toBe(true);
    expect(mapped && unmapped, `${id} is both mapped and left out`).toBe(false);
  });

  it('places no skill the library doesn’t have (the Operator’s own comes in PR 4)', () => {
    const known = new Set([...everySkill, OPERATOR_SKILL]);
    expect(
      [...Object.keys(SKILL_FIT), ...Object.keys(UNMAPPED_SKILLS)].filter((id) => !known.has(id)),
    ).toEqual([]);
  });

  it('maps a skill to real categories and KPIs only, each serving some work', () => {
    for (const [id, fit] of Object.entries(SKILL_FIT)) {
      for (const category of fit.actions) expect(ACTION_CATEGORIES, id).toContain(category);
      for (const category of fit.signals) expect(SIGNAL_CATEGORIES, id).toContain(category);
      for (const kpi of fit.kpis) expect(KPI_KEYS, id).toContain(kpi);
      expect(fit.actions.length + fit.signals.length + fit.kpis.length, id).toBeGreaterThan(0);
    }
  });

  it.each([
    ['winback', ['recover'], ['citation']],
    ['beat', ['compete'], ['competitor']],
    ['compare', ['compete'], ['competitor']],
    ['rivals', ['compete'], ['competitor']],
    ['markets', ['compete'], ['competitor']],
    ['refresh', ['protect'], ['mention']],
    ['wrongclaim', ['protect'], ['mention']],
    ['facts', ['protect'], ['mention']],
    ['audit-fix', ['fix'], ['technical']],
    ['faq', ['growth'], ['visibility']],
    ['fanout', ['growth'], ['visibility']],
    ['answerfirst', ['growth'], ['visibility']],
    ['questions', ['growth'], ['visibility']],
    ['features', ['growth'], ['visibility']],
    ['gaps', ['growth'], ['visibility']],
    ['content-plan', ['growth'], ['visibility']],
    ['prompts', ['growth'], ['visibility']],
  ])('maps /%s as the plan’s examples do', (id, actions, signals) => {
    expect(skillFit(id)).toMatchObject({ actions, signals });
  });

  it('maps the brand-facts skills to positive sentiment, as the guardian preset’s KPI trigger', () => {
    for (const id of ['refresh', 'wrongclaim', 'facts']) {
      expect(skillFit(id)?.kpis, id).toEqual(['positive_sentiment']);
    }
  });

  it('maps /tasks to every category and to today’s focus', () => {
    expect(skillFit('tasks')).toEqual({
      actions: [...ACTION_CATEGORIES],
      signals: [],
      kpis: [],
      focus: true,
    });
  });

  it.each(['report', 'publish', 'setup', 'translate', 'analyze', 'operator', 'my-own-skill'])(
    'maps /%s to nothing',
    (id) => {
      expect(skillFit(id)).toBeNull();
    },
  );
});

describe('an agent’s fit', () => {
  it('joins its skills’, each once, in the registries’ order', () => {
    expect(
      agentFit({
        skills: ['refresh', 'winback', 'facts'],
        signalTriggerCategories: [],
        kpiTriggers: [],
      }),
    ).toEqual({
      actions: ['protect', 'recover'],
      signals: ['citation', 'mention'],
      kpis: ['citations', 'positive_sentiment'],
      focus: false,
    });
  });

  it('adds its Signal triggers’ categories and its KPI triggers’ KPIs', () => {
    // Visibility Watch: /report (nothing), a KPI trigger on AI visibility.
    expect(
      agentFit({ skills: ['report'], signalTriggerCategories: [], kpiTriggers: ['ai_visibility'] }),
    ).toEqual({ actions: [], signals: [], kpis: ['ai_visibility'], focus: false });
    expect(
      agentFit({ skills: ['report'], signalTriggerCategories: ['compete'], kpiTriggers: [] }),
    ).toMatchObject({ actions: ['compete'] });
  });

  it('leaves out what the registries don’t know', () => {
    expect(
      agentFit({
        skills: ['unknown'],
        signalTriggerCategories: ['nonsense'],
        kpiTriggers: ['made_up_kpi'],
      }),
    ).toEqual({ actions: [], signals: [], kpis: [], focus: false });
  });
});
