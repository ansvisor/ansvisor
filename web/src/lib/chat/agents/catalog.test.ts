// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { presetTriggerDraft, triggerError, triggerInputOf } from '../agent-form';
import { DEFAULT_AGENT_SETTINGS, agentTriggerSchema, modeDenial } from '../agent-rules';
import { skillConnections } from '../agent-skills';
import { planFactsFromOrgRow, planGateLock } from '../plan-facts';
import { SKILL_LIBRARY } from '../skills/library';
import {
  AGENT_PRESETS,
  PRESET_FILTERS,
  PRESET_NEEDS,
  PRESET_ORDER,
  buildPresetCatalog,
  filterPresets,
  presetFilterOptions,
  presetGate,
  presetSameness,
  readyPreset,
  type AgentPreset,
} from './catalog';

/**
 * Agent Center's ready-to-use agents (AGENTS plan §1, §3; CHAT-21 §D item
 * 15) as data: each preset file keeps the format and is in catalog.json,
 * which the app reads (refresh: `yarn test -u src/lib/chat/agents`). A
 * ready preset is made only of what works today: skills in the library,
 * triggers New agent offers, a mode its plan gate says honestly. A soon one
 * says what it waits for. No two presets are one agent under two names.
 */

const PRESETS = path.join(__dirname, 'presets');
const files = readdirSync(PRESETS)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({ file, json: JSON.parse(readFileSync(path.join(PRESETS, file), 'utf8')) }));

const NOW = new Date('2026-10-31T12:00:00Z');
const LIBRARY = new Set(SKILL_LIBRARY.map((skill) => skill.name));
const chatAgents = messages.chatAgents as unknown as {
  presets: Record<string, { name?: string; description?: string }>;
  ready: {
    needs: Record<string, string>;
    goals: Record<string, string>;
    businessTypes: Record<string, string>;
    industries: Record<string, string>;
    roles: Record<string, string>;
  };
  connections: { names: Record<string, string> };
};

describe('the preset files', () => {
  it('each keep the format, named by their id, and are what catalog.json holds', async () => {
    for (const { file, json } of files) {
      expect(`${(json as { id?: string }).id}.json`, file).toBe(file);
    }
    const catalog = buildPresetCatalog(files);
    expect(catalog.presets.map((preset) => preset.id)).toEqual([...PRESET_ORDER]);
    await expect(`${JSON.stringify(catalog, null, 2)}\n`).toMatchFileSnapshot('./catalog.json');
  });

  it('are the launch set ready, and what comes next as Soon', () => {
    const ready = AGENT_PRESETS.filter((preset) => preset.status === 'ready').map((p) => p.id);
    expect(ready).toEqual([
      'visibility-watch',
      'citation-winback',
      'competitor-watch',
      'content-freshness',
      'ready-to-publish',
      'task-finisher',
      'weekly-report',
      'brand-facts-guardian',
    ]);
    expect(AGENT_PRESETS.filter((preset) => preset.status === 'soon')).toHaveLength(12);
  });

  it('name each in en.json, with its line, and every goal, tag and need they use', () => {
    const { presets, ready } = chatAgents;
    for (const preset of AGENT_PRESETS) {
      expect(presets[preset.id]?.name, preset.id).toBeTruthy();
      expect(presets[preset.id]?.description, preset.id).toBeTruthy();
      expect(ready.goals[preset.goal], preset.goal).toBeTruthy();
      for (const tag of preset.businessTypes) expect(ready.businessTypes[tag], tag).toBeTruthy();
      for (const tag of preset.industries) expect(ready.industries[tag], tag).toBeTruthy();
      for (const tag of preset.roles) expect(ready.roles[tag], tag).toBeTruthy();
    }
    for (const need of PRESET_NEEDS) expect(ready.needs[need], need).toBeTruthy();
    // No line for a preset that isn't in the catalog.
    expect(Object.keys(presets).sort()).toEqual(AGENT_PRESETS.map((p) => p.id).sort());
  });
});

describe('a ready preset', () => {
  const ready = AGENT_PRESETS.filter((preset) => preset.status === 'ready');

  it('is made of skills in the library: a primary one and at most 2 follow-on', () => {
    for (const preset of ready) {
      expect(preset.skills.length, preset.id).toBeGreaterThanOrEqual(1);
      expect(preset.skills.length, preset.id).toBeLessThanOrEqual(3);
      for (const skill of preset.skills)
        expect(LIBRARY.has(skill), `${preset.id}: /${skill}`).toBe(true);
    }
  });

  it('starts with triggers New agent offers, valid as the API takes them', () => {
    for (const preset of ready) {
      preset.triggers.forEach((trigger, i) => {
        const draft = presetTriggerDraft(trigger, `k${i}`, 'Europe/Istanbul');
        expect(triggerError(draft, NOW), `${preset.id} trigger ${i}`).toBeNull();
        const input = triggerInputOf(draft);
        expect(agentTriggerSchema.safeParse(input).success, `${preset.id} trigger ${i}`).toBe(true);
      });
    }
  });

  it('asks for the connections its skills use as they say, and only known Optional ones besides', () => {
    for (const preset of AGENT_PRESETS) {
      // What New agent will show: Required only where a skill can't work without it.
      const used = skillConnections(preset.skills).map(({ key, required }) => ({ key, required }));
      expect(preset.connections.slice(0, used.length), preset.id).toEqual(used);
      for (const c of preset.connections.slice(used.length)) {
        expect(c.required, `${preset.id}: ${c.key}`).toBe(false);
      }
      for (const c of preset.connections) {
        expect(chatAgents.connections.names[c.key], `${preset.id}: ${c.key}`).toBeTruthy();
      }
    }
    // Any CMS, never one product: only Ready to Publish can't work without it.
    expect(readyPreset('ready-to-publish')?.connections).toEqual([{ key: 'cms', required: true }]);
    expect(readyPreset('citation-winback')?.connections).toEqual([
      { key: 'google_search_console', required: false },
      { key: 'cms', required: false },
    ]);
  });

  it('is found by its id; a soon one, or no id, is not', () => {
    expect(readyPreset('weekly-report')?.id).toBe('weekly-report');
    expect(readyPreset('onboarding-help')).toBeNull();
    expect(readyPreset('nope')).toBeNull();
    expect(readyPreset(null)).toBeNull();
  });
});

describe('a soon preset', () => {
  it('says what it waits for, and names only skills the library has', () => {
    for (const preset of AGENT_PRESETS.filter((p) => p.status === 'soon')) {
      expect(preset.needs.length, preset.id).toBeGreaterThan(0);
      for (const skill of preset.skills)
        expect(LIBRARY.has(skill), `${preset.id}: /${skill}`).toBe(true);
    }
  });

  it('is refused as a file when it needs nothing, as a ready one that needs something is', () => {
    const base = AGENT_PRESETS.find((preset) => preset.id === 'onboarding-help')!;
    expect(() => buildPresetCatalog([{ file: 'x.json', json: { ...base, needs: [] } }])).toThrow(
      /needs/,
    );
    const shown = AGENT_PRESETS.find((preset) => preset.id === 'weekly-report')!;
    expect(() =>
      buildPresetCatalog([{ file: 'y.json', json: { ...shown, needs: ['hubspot'] } }]),
    ).toThrow(/needs/);
    expect(() => buildPresetCatalog([{ file: 'z.json', json: { ...shown, skills: [] } }])).toThrow(
      /skill/,
    );
  });
});

describe('no renamed copies', () => {
  it('no two presets share a primary skill and its triggers', () => {
    const seen = new Map<string, string>();
    for (const preset of AGENT_PRESETS) {
      const key = presetSameness(preset);
      if (!key) continue;
      expect(seen.get(key), `${preset.id} is ${seen.get(key)} again`).toBeUndefined();
      seen.set(key, preset.id);
    }
  });

  it('tells two presets apart by their triggers, not their order', () => {
    const one: Pick<AgentPreset, 'skills' | 'triggers'> = {
      skills: ['report'],
      triggers: [
        { kind: 'signal', category: 'recover' },
        { kind: 'schedule', repeat: 'MO', time: '09:00' },
      ],
    };
    const again = { skills: ['report', 'faq'], triggers: [...one.triggers].reverse() };
    expect(presetSameness(again)).toBe(presetSameness(one));
    expect(presetSameness({ ...one, triggers: [] })).not.toBe(presetSameness(one));
    expect(presetSameness({ skills: [], triggers: [] })).toBeNull();
  });
});

describe('the plan a preset needs', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  const workspaces = [
    { plan: 'starter', subscription_status: 'active' },
    { plan: 'starter', subscription_status: 'trialing' },
    { plan: 'growth', subscription_status: 'trialing' },
    { plan: 'growth', subscription_status: 'active' },
    { plan: 'enterprise', subscription_status: 'active' },
  ];

  it('locks on the card exactly where the server refuses the mode', () => {
    for (const row of workspaces) {
      const facts = planFactsFromOrgRow(row);
      for (const preset of AGENT_PRESETS) {
        const lock = planGateLock(facts, presetGate(preset));
        const denial = modeDenial(preset.mode, facts, DEFAULT_AGENT_SETTINGS, 'admin');
        const refused = denial?.denial.code === 'plan_locked' ? denial.denial.needs : null;
        expect(lock, `${preset.id} on ${row.plan} ${row.subscription_status}`).toBe(refused);
      }
    }
  });

  it('is Growth for Full auto and nothing otherwise; never an own key', () => {
    expect(presetGate({ mode: 'full_auto' })).toEqual({ minPlan: 'growth' });
    expect(presetGate({ mode: 'auto' })).toBeNull();
    expect(presetGate({ mode: 'ask_first' })).toBeNull();
    expect(readyPreset('weekly-report')?.mode).toBe('full_auto');
  });

  it('is open off the cloud', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const facts = planFactsFromOrgRow(null);
    for (const preset of AGENT_PRESETS) expect(planGateLock(facts, presetGate(preset))).toBeNull();
  });
});

describe('the filters', () => {
  const fake = (id: string, over: Partial<AgentPreset> = {}): AgentPreset => ({
    id,
    goal: 'content',
    businessTypes: [],
    industries: [],
    roles: [],
    skills: ['faq'],
    triggers: [],
    mode: 'auto',
    connections: [],
    status: 'ready',
    needs: [],
    ...over,
  });

  it('show only the goals the presets have, and no filter nobody carries', () => {
    const options = presetFilterOptions(AGENT_PRESETS);
    expect(options.map((option) => option.filter)).toEqual(['goal']);
    expect(options[0].values).toEqual([
      'visibility',
      'citations',
      'content',
      'competitors',
      'technical',
      'shopping',
      'tasks',
      'reporting',
      'help',
    ]);
  });

  it('show a business type, industry or role once a preset carries one, in their lists’ order', () => {
    const options = presetFilterOptions([
      fake('a', { businessTypes: ['b2b'], roles: ['founders'] }),
      fake('b', { goal: 'help', businessTypes: ['ecommerce'], industries: ['saas'] }),
    ]);
    expect(options).toEqual([
      { filter: 'goal', values: ['content', 'help'] },
      { filter: 'businessType', values: ['ecommerce', 'b2b'] },
      { filter: 'industry', values: ['saas'] },
      { filter: 'role', values: ['founders'] },
    ]);
    expect(PRESET_FILTERS).toEqual(['goal', 'businessType', 'industry', 'role']);
  });

  it('keep the presets a pick matches, ready ones first', () => {
    const list = [
      fake('soon-1', { status: 'soon', needs: ['hubspot'] }),
      fake('a', { businessTypes: ['b2b'] }),
      fake('b', { goal: 'help' }),
    ];
    expect(filterPresets(list, {}).map((p) => p.id)).toEqual(['a', 'b', 'soon-1']);
    expect(filterPresets(list, { goal: 'content' }).map((p) => p.id)).toEqual(['a', 'soon-1']);
    expect(filterPresets(list, { goal: 'content', businessType: 'b2b' }).map((p) => p.id)).toEqual([
      'a',
    ]);
    expect(filterPresets(list, { goal: null }).map((p) => p.id)).toEqual(['a', 'b', 'soon-1']);
  });
});
