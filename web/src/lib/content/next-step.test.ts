import { describe, expect, it } from 'vitest';
import {
  liveSkips,
  nextStep,
  rulesForNext,
  stepState,
  thirdStepTried,
  type NextStepState,
} from './next-step';
import type { QualityTodo } from './quality-todos';

/**
 * The Next step basket's rules (Next step spec §4): the first state that
 * calls for a step wins; Skip passes a step until its state changes.
 */

const todo = (over: Partial<QualityTodo>): QualityTodo => ({
  id: 'byline',
  done: false,
  gain: 15,
  score: 'eeat',
  action: 'pickAuthor',
  ...over,
});

const state = (over: Partial<NextStepState> = {}): NextStepState => ({
  method: 'create',
  open: true,
  published: false,
  hasBrief: true,
  empty: false,
  rewrite: null,
  openRules: [],
  quality: { trust: 72, trustLow: false, todos: [] },
  skipped: {},
  ...over,
});

/** n open rule keys. */
const rules = (n: number) => Array.from({ length: n }, (_, i) => `rule${i}`);

const ids = (s: NextStepState) => nextStep(s).path.map((p) => `${p.id}:${p.state}`);

describe('nextStep', () => {
  it('plans a new page with no brief, then writes it (mockup: New page)', () => {
    const s = state({ hasBrief: false, empty: true, openRules: rules(13) });
    expect(nextStep(s).step).toEqual({
      id: 'plan',
      primary: 'buildBrief',
      alternative: null,
      skippable: true,
    });
    expect(ids(s)).toEqual([
      'plan:now',
      'write:ahead',
      'fixRules:ahead',
      'proof:ahead',
      'check:ahead',
    ]);
    // An empty page: nothing to fix or rewrite yet, and no line repeats Build brief.
    expect(nextStep(s).tips).toEqual([]);
    expect(nextStep({ ...s, hasBrief: true }).step).toMatchObject({
      id: 'write',
      primary: 'writeWithAgent',
      alternative: 'writeMyself',
    });
  });

  it("stays on writing an empty page once the person said they'd write it", () => {
    const s = state({
      empty: true,
      openRules: rules(6),
      rewrite: { reason: 'length', count: 40, target: 3_000, percent: 99 },
    });
    // Its title alone isn't read against its Length.
    expect(ids(s)).toContain('fixRules:ahead');
    const mine = { ...s, skipped: { write: stepState('write', s) } };
    expect(nextStep(mine).step).toEqual({
      id: 'write',
      primary: 'writeMyself',
      alternative: null,
      skippable: false,
    });
    // Words in: the page moves on, and the skip has had its day.
    const written = { ...mine, empty: false };
    expect(nextStep(written).step.id).toBe('length');
    expect(liveSkips(written)).toEqual({});
  });

  it('rewrites a page far off its Length before fixing rules (mockup: Long imported page)', () => {
    const s = state({
      method: 'optimize',
      hasBrief: false,
      rewrite: { reason: 'length', count: 19_203, target: 8_000, percent: 140 },
      openRules: rules(3),
    });
    expect(nextStep(s).step).toMatchObject({
      id: 'length',
      primary: 'rewritePage',
      alternative: 'fixRules',
    });
    // An optimize draft starts here once its page is in.
    expect(ids(s)).toEqual([
      'plan:done',
      'import:done',
      'length:now',
      'proof:ahead',
      'check:ahead',
    ]);
    // Rewrite page is the step's own button, and Fix open rules its other one: no line repeats them.
    expect(nextStep(s).tips).toEqual([]);
  });

  it('offers Rewrite page beside Fix open rules where the Rules tab recommends it', () => {
    expect(nextStep(state({ openRules: rules(3) })).step).toMatchObject({
      id: 'fixRules',
      alternative: null,
    });
    const many = state({ openRules: rules(4), rewrite: { reason: 'open', count: 4 } });
    expect(nextStep(many).step).toMatchObject({ id: 'fixRules', alternative: 'rewritePage' });
    // A page too long to send whole gets no rewrite advice, and no Rewrite page.
    expect(nextStep({ ...many, rewrite: null }).step.alternative).toBeNull();
  });

  it('names a few open rules once Fix open rules is passed', () => {
    const s = state({ openRules: ['faq', 'summary'] });
    expect(nextStep({ ...s, skipped: { fixRules: stepState('fixRules', s) } }).tips).toEqual([
      { id: 'someRules', action: 'fixRules' },
    ]);
  });

  it('asks for proof and the author while Trust is low or a to-do is open (mockup: Almost ready)', () => {
    const low = state({ quality: { trust: 54, trustLow: true, todos: [todo({})] } });
    expect(nextStep(low).step).toMatchObject({ id: 'proof', primary: 'pickAuthor' });
    expect(ids(low)).toEqual([
      'plan:done',
      'write:done',
      'fixRules:done',
      'proof:now',
      'check:ahead',
    ]);
    expect(nextStep(low).tips).toEqual([{ id: 'lowTrust', action: 'showTodos' }]);
    expect(
      nextStep(state({ quality: { trust: 54, trustLow: true, todos: [] } })).step.primary,
    ).toBe('showTodos');
    expect(
      nextStep(
        state({ quality: { trust: 80, trustLow: false, todos: [todo({ action: 'addAuthor' })] } }),
      ).step.primary,
    ).toBe('addAuthor');
  });

  it('checks before marking ready, and exports once ready', () => {
    expect(nextStep(state()).step).toEqual({
      id: 'check',
      primary: 'beforePublish',
      alternative: null,
      skippable: false,
    });
    // Quality off: Mark ready, and no proof step on the path.
    expect(nextStep(state({ quality: null })).step.primary).toBe('markReady');
    expect(ids(state({ quality: null }))).toHaveLength(4);
    const ready = state({ open: false, openRules: rules(3) });
    // Marked ready: Mark published beside Export, for its live address (CE-013); published, Export alone.
    expect(nextStep(ready).step).toMatchObject({
      id: 'ready',
      primary: 'export',
      alternative: 'markPublished',
    });
    expect(nextStep({ ...ready, published: true }).step.alternative).toBeNull();
    expect(nextStep(ready).path.every((p) => p.state === 'done' || p.state === 'skipped')).toBe(
      true,
    );
    expect(nextStep(ready).tips).toEqual([]);
  });

  it('passes a skipped step until its state changes', () => {
    const s = state({ openRules: rules(3), quality: { trust: 54, trustLow: true, todos: [] } });
    const skipped = { ...s, skipped: { fixRules: stepState('fixRules', s) } };
    expect(nextStep(skipped).step.id).toBe('proof');
    expect(ids(skipped)).toContain('fixRules:skipped');
    // One rule met: it comes back.
    expect(nextStep({ ...skipped, openRules: rules(2) }).step.id).toBe('fixRules');
    // Typing doesn't bring a Length step back; turning from too long to too short does.
    const long = state({
      rewrite: { reason: 'length', count: 12_000, target: 8_000, percent: 50 },
    });
    const passed = { ...long, skipped: { length: stepState('length', long) } };
    expect(nextStep(passed).step.id).toBe('check');
    expect(
      nextStep({
        ...passed,
        rewrite: { reason: 'length', count: 9_000, target: 8_000, percent: 31 },
      }).step.id,
    ).toBe('check');
    expect(
      nextStep({
        ...passed,
        rewrite: { reason: 'length', count: 4_000, target: 8_000, percent: 50 },
      }).step.id,
    ).toBe('length');
  });

  it("keeps a proof skip when the brand facts' to-do joins later (review, #1465)", () => {
    const s = state({ quality: { trust: 54, trustLow: true, todos: [todo({})] } });
    const skipped = { ...s, skipped: { proof: stepState('proof', s) } };
    const withFacts = {
      ...skipped,
      quality: {
        trust: 54,
        trustLow: true,
        todos: [
          todo({}),
          todo({ id: 'brandFacts', action: 'reviewBrandFacts', score: 'trust', gain: 0, count: 2 }),
        ],
      },
    };
    expect(liveSkips(withFacts)).toEqual({ proof: stepState('proof', s) });
  });

  it('drops a skip once its state changed, so it never comes back to life', () => {
    const s = state({ openRules: ['faq', 'summary'] });
    const skipped = { ...s, skipped: { fixRules: stepState('fixRules', s) } };
    expect(liveSkips(skipped)).toEqual({ fixRules: 'faq,summary' });
    expect(liveSkips({ ...skipped, openRules: ['faq'] })).toEqual({});
  });

  it('reads each proof to-do by its own key: another claim opening brings a skipped step back (CE-049)', () => {
    const proof = (key: string) =>
      todo({ id: 'proof', key, score: 'trust', action: 'addProof', gain: 3 });
    const s = state({
      quality: { trust: 54, trustLow: true, todos: [proof('proof:a:1'), proof('proof:b:2')] },
    });
    const skipped = { ...s, skipped: { proof: stepState('proof', s) } };
    expect(liveSkips(skipped)).toEqual({ proof: 'true:proof:a:1,proof:b:2' });
    expect(
      liveSkips({
        ...skipped,
        quality: { trust: 54, trustLow: true, todos: [proof('proof:a:1'), proof('proof:c:3')] },
      }),
    ).toEqual({});
  });
});

describe('the third step, once the agent took it (editor test 2026-10-26)', () => {
  it('moves on to proof with a rule still open and the Length off', () => {
    // As on the tested page: Trust 47, under its gate.
    const quality = { trust: 47, trustLow: true, todos: [] };
    const fix = state({ method: 'optimize', openRules: ['h2Answer'], quality });
    expect(nextStep(fix).step.id).toBe('fixRules');
    expect(nextStep({ ...fix, thirdTried: true }).step.id).toBe('proof');
    expect(ids({ ...fix, thirdTried: true })).toEqual([
      'plan:done',
      'import:done',
      'fixRules:done',
      'proof:now',
      'check:ahead',
    ]);
    // A page far off its Length passes its rewrite step the same way.
    const long = state({
      method: 'optimize',
      rewrite: { reason: 'length', count: 17_683, target: 13_998, percent: 26 },
      openRules: ['h2Answer'],
      quality,
    });
    expect(nextStep(long).step.id).toBe('length');
    expect(nextStep({ ...long, thirdTried: true }).step.id).toBe('proof');
    // With Quality off, to Mark ready.
    expect(nextStep({ ...long, quality: null, thirdTried: true }).step.id).toBe('check');
  });

  it('keeps the steps before it: an empty page is still written first', () => {
    const s = state({ empty: true, openRules: rules(3), thirdTried: true });
    expect(nextStep(s).step.id).toBe('write');
  });

  it("reads the agent's run as taken once what it left is decided, or it ended with nothing", () => {
    const attempt = { batch: 'b1' };
    // The run is under way, or its batch waits for a decision: not yet.
    expect(thirdStepTried(attempt, { batch: 'b1', open: 0, busy: true })).toBe(false);
    expect(thirdStepTried(attempt, { batch: 'b2', open: 3, busy: false })).toBe(false);
    // Its batch, every change decided (accepted or rejected).
    expect(thirdStepTried(attempt, { batch: 'b2', open: 0, busy: false })).toBe(true);
    // The batch from before it is no answer of its: stopped, the step stays.
    expect(thirdStepTried(attempt, { batch: 'b1', open: 0, busy: false })).toBe(false);
    // It found nothing to change: there's nothing to decide.
    expect(thirdStepTried({ ...attempt, ended: true }, { batch: 'b1', open: 0, busy: false })).toBe(
      true,
    );
    // A first batch, on a page that had none.
    expect(thirdStepTried({ batch: null }, { batch: 'b1', open: 0, busy: false })).toBe(true);
    expect(thirdStepTried(null, { batch: 'b1', open: 0, busy: false })).toBe(false);
    // Found nothing, but another run is under way: not yet.
    expect(thirdStepTried({ ...attempt, ended: true }, { batch: 'b1', open: 0, busy: true })).toBe(
      false,
    );
    // Once taken, a later run working or its changes waiting don't bring it back.
    expect(thirdStepTried({ ...attempt, passed: true }, { batch: 'b3', open: 2, busy: true })).toBe(
      true,
    );
  });
});

describe('rulesForNext', () => {
  it('counts the open rules a Fix run can close: not a setting only the person fills, not Length', () => {
    const rule = (key: string) => ({ key, on: true, current: '' }) as never;
    expect(
      rulesForNext([
        { rule: rule('summary'), status: { state: 'bad', code: 'missing' } },
        { rule: rule('whoFor'), status: { state: 'bad', code: 'notSet' } },
        {
          rule: rule('length'),
          status: { state: 'bad', code: 'short', count: 2_500, min: 2_700, max: 3_300 },
        },
        { rule: rule('oneH1'), status: { state: 'bad', code: 'over', count: 2 } },
        { rule: rule('faq'), status: { state: 'ok' } },
        { rule: rule('aiTraces'), status: { state: 'bad', code: 'found', count: 1 } },
      ]),
    ).toEqual(['aiTraces', 'summary']);
  });

  it('leaves out rules held by what the page keeps: no Fix run closes them, so Next moves on', () => {
    const rule = (key: string) => ({ key, on: true, current: '150' }) as never;
    const statuses = [
      {
        rule: rule('sentence'),
        status: { state: 'bad' as const, code: 'over' as const, count: 3 },
      },
      { rule: rule('summary'), status: { state: 'ok' as const } },
    ];
    expect(rulesForNext(statuses)).toEqual(['sentence']);
    expect(rulesForNext(statuses, new Set(['sentence']))).toEqual([]);
  });
});
