import { describe, expect, it, vi } from 'vitest';

// loadDefinitions reaches sources.js, which imports the admin client.
vi.mock('../../../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));

import { actionFacts, concreteTask, pageName } from './concrete.js';
import { planTasks } from './plan.js';
import { loadDefinitions } from '../definitions/index.js';
import { combinedTasks } from '../from-opportunity.js';
import { isTouched } from '../task-writer/index.js';

const ALL = new Set(['tracking', 'competitors', 'site_audits', 'analytics', 'search_console']);

const byId = async (id) => (await loadDefinitions()).find((d) => d.id === id);
const groupByKind = (signals) => {
  const map = new Map();
  for (const s of signals) map.set(s.kind, [...(map.get(s.kind) ?? []), s]);
  return map;
};

/** Every planned task's title and spec, keyed by task. */
const specs = (plan) => Object.fromEntries(plan.map((item) => [item.taskKey, item]));

/** Generic count-based wording, as the library messages render it. */
const GENERIC = /\b(?:across|for|with|on)\s+\d+\s+(?:prompts?|competitors?|pages?|platforms?)\b/i;

function expectConcrete(item, ...names) {
  expect(item.title).toBeTruthy();
  expect(item.title).not.toMatch(GENERIC);
  for (const name of names) expect(item.title).toContain(name);
  expect(item.details.source).toBe('template');
  expect(item.details.where).toBeTruthy();
  expect(item.details.how.length).toBeGreaterThanOrEqual(2);
  expect(item.details.how.length).toBeLessThanOrEqual(4);
  expect(item.details.doneWhen).toBeTruthy();
}

describe('concrete tasks: close the competitor gap (C01)', () => {
  const signal = {
    id: 's1',
    kind: 'competitor_leads',
    payload: {
      competitorName: 'Northbound Roasters',
      positions: [
        {
          promptId: 'p1',
          promptText: 'best coffee subscription',
          platform: 'chatgpt-web',
          competitor: { now: 80 },
          you: { now: 20 },
        },
        {
          promptId: 'p2',
          promptText: 'best decaf coffee beans',
          platform: 'gemini-web',
          competitor: { now: 40 },
          you: { now: 30 },
        },
      ],
      winningSources: [{ domain: 'coffeereview.example', answers: 4 }],
    },
  };

  it('names the competitor, the prompt and the platforms on every task', async () => {
    const definition = await byId('close_competitor_gap');
    const payload = definition.payload(groupByKind([signal]));
    expect(payload.leadPrompt).toEqual({ id: 'p1', text: 'best coffee subscription' });
    const plan = specs(planTasks(definition, { sources: ALL, payload, signals: [signal] }));

    expectConcrete(
      plan.analyze_competitor_visibility,
      'Northbound Roasters',
      '“best coffee subscription”',
    );
    expectConcrete(
      plan.analyze_competitor_content,
      'Northbound Roasters',
      '“best coffee subscription”',
    );
    expectConcrete(plan.analyze_citations, 'coffeereview.example');
    expectConcrete(plan.optimize_content, '“best coffee subscription” and 1 related prompt');
    expectConcrete(plan.validate_competitive_gap, 'Northbound Roasters');
    expectConcrete(plan.measure_action_outcome, '“best coffee subscription”');
    expect(plan.validate_competitive_gap.details.check).toBe('rerun');
    expect(plan.analyze_ai_responses.title).toBe(
      'Read how ChatGPT and Gemini answer “best coffee subscription” and 1 related prompt',
    );
  });

  it('names the competitor alone when its signals carry no positions', async () => {
    const definition = await byId('close_competitor_gap');
    const bare = { id: 's', kind: 'competitor_leads', payload: { competitorName: 'Northbound' } };
    const payload = definition.payload(groupByKind([bare]));
    expect(payload.leadPrompt).toBeUndefined();
    const plan = specs(planTasks(definition, { sources: ALL, payload, signals: [bare] }));
    // Nothing to name a prompt by: those tasks keep their library message.
    expect(plan.analyze_ai_responses.title).toBeNull();
    expect(plan.analyze_ai_responses.titleParams).toEqual({ count: 1, entity: 'competitors' });
  });
});

describe('concrete tasks: content opportunity', () => {
  const prompts = [
    { id: 'p1', text: 'Is a coffee subscription worth it?' },
    { id: 'p2', text: 'coffee subscription pros and cons' },
  ];

  it('updates the named page for its prompts', () => {
    const asset = { key: 'a', decision: 'optimize', channel: 'owned', title: 'Subscriptions' };
    const payload = {
      source: 'content_opportunity',
      title: 'Answer whether a subscription is worth it',
      assets: [asset],
      pages: ['https://brewline.example/subscriptions'],
      targetEntity: 'prompts',
      targetCount: 2,
      targets: prompts,
      contentExists: true,
    };
    const plan = specs(
      planTasks(
        { id: 'content_opportunity', tasks: combinedTasks([asset]) },
        { sources: ALL, payload },
      ),
    );
    expect(plan.optimize_content.title).toBe(
      'Update /subscriptions to answer “Is a coffee subscription worth it?” and 1 related prompt',
    );
    expect(plan.optimize_content.details.url).toBe('https://brewline.example/subscriptions');
    expect(plan.optimize_content.details.where).toBe('https://brewline.example/subscriptions');
    expectConcrete(plan.add_internal_links, '/subscriptions');
    expectConcrete(plan.publish_content, '/subscriptions');
    expectConcrete(plan.validate_ai_visibility, '“Is a coffee subscription worth it?”');
  });

  it('briefs and drafts the new page by its title', () => {
    const asset = { key: 'b', decision: 'create', channel: 'owned', title: 'Coffee subscriptions' };
    const payload = {
      source: 'content_opportunity',
      title: 'Is a coffee subscription worth it?',
      assets: [asset],
      pages: [],
      targetEntity: 'prompts',
      targetCount: 2,
      targets: prompts,
      contentExists: false,
    };
    const plan = specs(
      planTasks(
        { id: 'content_opportunity', tasks: combinedTasks([asset]) },
        { sources: ALL, payload },
      ),
    );
    expect(plan.create_content_brief.title).toBe('Brief “Is a coffee subscription worth it?”');
    expectConcrete(plan.create_content_draft, 'Draft “Is a coffee subscription worth it?”');
    // No page yet: its links wait for one.
    expect(plan.add_internal_links.title).toBeNull();
  });
});

describe('concrete tasks: prompt kinds (G03, P01, R04)', () => {
  const prompt = (kind) => ({
    id: 's',
    kind,
    payload: {
      entity: 'prompts',
      targets: [
        { id: 'p1', label: 'best decaf coffee beans' },
        { id: 'p2', label: 'low acid coffee' },
        { id: 'p3', label: 'swiss water decaf' },
      ],
    },
  });

  it.each([
    [
      'expand_prompt_visibility',
      'prompt_visibility_gap',
      ['analyze_prompt_gap', 'map_prompts_to_content'],
    ],
    [
      'protect_visibility',
      'visibility_slipping',
      ['analyze_visibility_change', 'validate_ai_visibility'],
    ],
    [
      'recover_lost_mentions',
      'lost_mentions',
      ['analyze_mention_context', 'identify_content_gaps'],
    ],
  ])('%s names its first prompt and how many more', async (id, kind, keys) => {
    const definition = await byId(id);
    const signal = prompt(kind);
    const payload = definition.payload(groupByKind([signal]));
    const plan = specs(planTasks(definition, { sources: ALL, payload, signals: [signal] }));
    for (const key of keys) {
      expectConcrete(plan[key], '“best decaf coffee beans” and 2 related prompts');
    }
  });
});

describe('concrete tasks: recover platform visibility (R06)', () => {
  it('names the platform', async () => {
    const definition = await byId('recover_platform_visibility');
    const signal = {
      id: 's',
      kind: 'platform_drop',
      payload: {
        platform: 'perplexity-web',
        entity: 'platforms',
        targets: [{ id: 'perplexity-web', label: 'perplexity-web' }],
      },
    };
    const payload = definition.payload(groupByKind([signal]));
    const plan = specs(planTasks(definition, { sources: ALL, payload, signals: [signal] }));
    expect(plan.analyze_platform_gap.title).toBe('See where Perplexity stopped naming you');
    expectConcrete(plan.validate_platform_visibility, 'Perplexity');
  });
});

describe('concrete tasks: helpers', () => {
  it('names nothing without facts', () => {
    expect(concreteTask('optimize_content', actionFacts({}, []))).toBeNull();
    expect(concreteTask('no_such_task', actionFacts({ promptText: 'x' }))).toBeNull();
  });

  it('shortens a page to its path, or its host for the home page', () => {
    expect(pageName('https://brewline.example/subscriptions/')).toBe('/subscriptions');
    expect(pageName('https://brewline.example/')).toBe('brewline.example');
    expect(pageName('/pricing')).toBe('/pricing');
  });

  it('leaves a concrete template task untouched until someone edits it', () => {
    const row = {
      task_key: 'optimize_content',
      status: 'todo',
      title: 'Update /x to answer “y”',
      details: { source: 'template', where: '/x', how: ['a', 'b'], doneWhen: 'z' },
    };
    expect(isTouched([row])).toBe(false);
    // The drawer's edit drops the template's mark.
    expect(isTouched([{ ...row, details: { ...row.details, source: undefined } }])).toBe(true);
    // A library task renamed with no details.
    expect(
      isTouched([{ task_key: 'optimize_content', status: 'todo', title: 'Mine', details: null }]),
    ).toBe(true);
  });
});
