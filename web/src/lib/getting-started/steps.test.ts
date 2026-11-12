import { describe, expect, it } from 'vitest';
import {
  GETTING_STARTED_STEPS,
  buildGettingStarted,
  isPageOpenedStep,
  pageOpenedStep,
  parseGettingStartedFacts,
  type GettingStartedFacts,
  type GettingStartedStepKey,
} from './steps';

/**
 * Getting started: the 7 set-up steps, whose state follows from the brand's
 * data. Optional steps can be skipped.
 */

const facts = (over: Partial<GettingStartedFacts> = {}): GettingStartedFacts => ({
  startedAt: '2026-10-20T10:00:00Z',
  dismissedAt: null,
  confirmedAt: '2026-10-20T10:00:00Z',
  records: {},
  recordedAt: {},
  kpiSetupAt: null,
  competitors: 0,
  topicPrompts: [],
  gsc: false,
  ga: false,
  firstAnswer: false,
  firstVisit: false,
  dataSuggestions: 0,
  dataTracked: 0,
  contentSuggestions: 0,
  contentPicked: 0,
  contentCreated: 0,
  contentRecent: 0,
  audits: 0,
  draftsCreated: 0,
  draftsOptimized: 0,
  ...over,
});

const step = (f: GettingStartedFacts, key: GettingStartedStepKey) =>
  buildGettingStarted(f).steps.find((s) => s.key === key)!;

describe('the step list', () => {
  it('has the 7 set-up steps in order, with no Ready step', () => {
    expect(GETTING_STARTED_STEPS.map((s) => `${s.stage}:${s.key}`)).toEqual([
      'setup:kpis',
      'setup:competitors',
      'setup:topics',
      'setup:prompts',
      'setup:gsc',
      'setup:ga',
      'setup:snippet',
    ]);
    expect(GETTING_STARTED_STEPS.filter((s) => s.optional).map((s) => s.key)).toEqual([
      'gsc',
      'ga',
    ]);
  });
});

describe('buildGettingStarted', () => {
  it('opens a new brand on the 7 set-up steps, each to do', () => {
    const status = buildGettingStarted(facts());
    expect(status.active).toBe(true);
    expect(status).toMatchObject({ done: 0, total: 7 });
    expect(status.steps.every((s) => s.state === 'new')).toBe(true);
  });

  it('counts KPIs saved from the KPI screen, or set up before the start', () => {
    // The ready-made set appeared after the start: not set yet.
    expect(step(facts({ kpiSetupAt: '2026-10-20T11:00:00Z' }), 'kpis').state).toBe('new');
    expect(step(facts({ records: { kpis: 'done' } }), 'kpis').state).toBe('done');
    // An existing customer's KPIs, from before Getting started.
    expect(step(facts({ kpiSetupAt: '2026-09-01T00:00:00Z' }), 'kpis').state).toBe('done');
    expect(step(facts({ startedAt: null, kpiSetupAt: '2026-10-20T11:00:00Z' }), 'kpis').state).toBe(
      'done',
    );
  });

  it('wants three competitors and three topics, with progress', () => {
    expect(step(facts({ competitors: 2 }), 'competitors')).toMatchObject({
      state: 'new',
      progress: { value: 2, target: 3 },
    });
    expect(step(facts({ competitors: 7 }), 'competitors')).toMatchObject({
      state: 'done',
      progress: { value: 3, target: 3 },
    });
    expect(step(facts({ topicPrompts: [0, 0] }), 'topics')).toMatchObject({
      state: 'new',
      progress: { value: 2, target: 3 },
    });
    expect(step(facts({ topicPrompts: [0, 0, 0] }), 'topics').state).toBe('done');
  });

  it('wants three prompts in every topic, and at least three topics of them', () => {
    // Two full topics of three: 6/9 until a third topic has its prompts.
    expect(step(facts({ topicPrompts: [3, 4] }), 'prompts')).toMatchObject({
      state: 'new',
      progress: { value: 6, target: 9 },
    });
    expect(step(facts({ topicPrompts: [3, 5, 3] }), 'prompts')).toMatchObject({
      state: 'done',
      progress: { value: 9, target: 9 },
    });
    // A fourth topic raises the bar; extra prompts elsewhere don't make up for it.
    expect(step(facts({ topicPrompts: [9, 3, 3, 1] }), 'prompts')).toMatchObject({
      state: 'new',
      progress: { value: 10, target: 12 },
    });
  });

  it('lets Search Console and Analytics be skipped, and done when connected anyway', () => {
    const skipped = facts({ records: { gsc: 'skipped', ga: 'skipped' } });
    expect(step(skipped, 'gsc').state).toBe('skipped');
    expect(step(skipped, 'ga').state).toBe('skipped');
    expect(step({ ...skipped, gsc: true }, 'gsc').state).toBe('done');
    expect(buildGettingStarted(skipped).done).toBe(2);
  });

  it('marks the snippet done on the first AI visit', () => {
    expect(step(facts({ firstVisit: true }), 'snippet').state).toBe('done');
  });

  it('dates the steps a person acted on, and only those', () => {
    const f = facts({
      competitors: 4,
      records: { gsc: 'skipped' },
      recordedAt: { gsc: '2026-10-20T12:05:00Z' },
    });
    expect(step(f, 'gsc').updatedAt).toBe('2026-10-20T12:05:00Z');
    expect(step(f, 'competitors').updatedAt).toBeNull();
  });

  it('is inactive for a brand that never started it, or skipped it', () => {
    expect(buildGettingStarted(facts({ startedAt: null })).active).toBe(false);
    expect(buildGettingStarted(facts({ dismissedAt: '2026-10-21T00:00:00Z' })).active).toBe(false);
  });

  it('asks first for a brand added beside others, until someone answers', () => {
    const asking = buildGettingStarted(facts({ confirmedAt: null }));
    expect(asking).toMatchObject({ active: false, asking: true });
    // Skipped from the question: neither running nor asking.
    expect(
      buildGettingStarted(facts({ confirmedAt: null, dismissedAt: '2026-10-21T00:00:00Z' })),
    ).toMatchObject({ active: false, asking: false });
  });

  it('offers it to a brand whose setup is incomplete (AC-ALT2 §5)', () => {
    const complete = {
      competitors: 3,
      topicPrompts: [3, 3, 3],
      gsc: true,
      contentRecent: 1,
    };
    expect(buildGettingStarted(facts(complete)).needsSetup).toBe(false);
    for (const gap of [
      { competitors: 2 },
      { topicPrompts: [3, 3] },
      { gsc: false },
      { contentRecent: 0 },
    ]) {
      expect(buildGettingStarted(facts({ ...complete, ...gap })).needsSetup).toBe(true);
    }
  });
});

describe('the 7 set-up steps', () => {
  const setup = (f: GettingStartedFacts) => buildGettingStarted(f);

  it('carries over what a brand already did, from its data and records', () => {
    const status = setup(
      facts({
        startedAt: null,
        confirmedAt: null,
        kpiSetupAt: '2026-09-01T00:00:00Z',
        competitors: 4,
        topicPrompts: [3, 5, 3],
        gsc: true,
        firstVisit: true,
        // Explore records still count where they are kept, but aren't listed.
        records: { visibility: 'opened', ga: 'skipped' },
      }),
    );
    expect(status.steps.map((s) => [s.key, s.state])).toEqual([
      ['kpis', 'done'],
      ['competitors', 'done'],
      ['topics', 'done'],
      ['prompts', 'done'],
      ['gsc', 'done'],
      ['ga', 'skipped'],
      ['snippet', 'done'],
    ]);
    expect(status).toMatchObject({ done: 7, total: 7 });
  });

  it('counts a skipped optional step as complete, and leaves the rest to do', () => {
    const status = setup(facts({ competitors: 3, records: { gsc: 'skipped' } }));
    expect(status.done).toBe(2);
    expect(status.steps.filter((s) => s.state === 'new').map((s) => s.key)).toEqual([
      'kpis',
      'topics',
      'prompts',
      'ga',
      'snippet',
    ]);
  });
});

describe('parseGettingStartedFacts', () => {
  it('reads the RPC jsonb', () => {
    expect(
      parseGettingStartedFacts({
        started_at: '2026-10-20T10:00:00+00:00',
        dismissed_at: null,
        confirmed_at: '2026-10-20T10:00:00+00:00',
        steps: {
          kpis: { state: 'done', at: '2026-10-20T12:00:00+00:00' },
          gsc: { state: 'skipped', at: '2026-10-20T12:05:00+00:00' },
          visibility: { state: 'opened', at: null },
          odd: { state: 'maybe', at: '2026-10-20T12:10:00+00:00' },
        },
        kpi_setup_at: '2026-10-20T11:00:00+00:00',
        competitors: 4,
        topic_prompts: [3, '2', null],
        gsc: true,
        ga: false,
        first_answer: true,
        first_visit: false,
        data_suggestions: 7,
        data_tracked: 1,
        content_suggestions: 3,
        content_picked: 0,
        content_created: 0,
        content_recent: 2,
        audits: 1,
        drafts_created: 1,
        drafts_optimized: 3,
      }),
    ).toEqual({
      startedAt: '2026-10-20T10:00:00+00:00',
      dismissedAt: null,
      confirmedAt: '2026-10-20T10:00:00+00:00',
      records: { kpis: 'done', gsc: 'skipped', visibility: 'opened' },
      recordedAt: { kpis: '2026-10-20T12:00:00+00:00', gsc: '2026-10-20T12:05:00+00:00' },
      kpiSetupAt: '2026-10-20T11:00:00+00:00',
      competitors: 4,
      topicPrompts: [3, 2, 0],
      gsc: true,
      ga: false,
      firstAnswer: true,
      firstVisit: false,
      dataSuggestions: 7,
      dataTracked: 1,
      contentSuggestions: 3,
      contentPicked: 0,
      contentCreated: 0,
      contentRecent: 2,
      audits: 1,
      draftsCreated: 1,
      draftsOptimized: 3,
    });
  });

  // gkhngyk on #1243: until 00197 is applied, the facts have no confirmed_at,
  // and every running brand would ask "Run Getting started?".
  it('reads a running brand as confirmed on a database without 00197', () => {
    const facts = parseGettingStartedFacts({ started_at: '2026-10-20T10:00:00+00:00' });
    expect(facts?.confirmedAt).toBe('2026-10-20T10:00:00+00:00');
    expect(
      parseGettingStartedFacts({ started_at: '2026-10-20T10:00:00+00:00', confirmed_at: null })
        ?.confirmedAt,
    ).toBeNull();
  });

  it('gives null for a brand the caller can’t see', () => {
    expect(parseGettingStartedFacts(null)).toBeNull();
  });
});

describe('pageOpenedStep', () => {
  it('maps the explore pages, their subpages included', () => {
    expect(pageOpenedStep('/dashboard/insights')).toBe('visibility');
    expect(pageOpenedStep('/dashboard/prompts')).toBe('answers');
    expect(pageOpenedStep('/dashboard/prompts/tracked')).toBe('answers');
    expect(pageOpenedStep('/dashboard/mentions')).toBe('mentions');
    expect(pageOpenedStep('/dashboard/citations/domains')).toBe('citations');
    expect(pageOpenedStep('/dashboard/traffic')).toBe('traffic');
  });

  it('leaves every other page alone', () => {
    expect(pageOpenedStep('/dashboard/prompts/insights')).toBeNull();
    expect(pageOpenedStep('/dashboard/prompts/suggestions')).toBeNull();
    expect(pageOpenedStep('/dashboard/insightsx')).toBeNull();
    expect(pageOpenedStep('/dashboard/action-center/actions')).toBeNull();
  });

  it('accepts only page steps from the client', () => {
    expect(isPageOpenedStep('mentions')).toBe(true);
    expect(isPageOpenedStep('kpis')).toBe(false);
    expect(isPageOpenedStep('mentions; drop table')).toBe(false);
  });
});
