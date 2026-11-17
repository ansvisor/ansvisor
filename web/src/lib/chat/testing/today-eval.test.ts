import { describe, expect, it } from 'vitest';
import {
  EVAL_ACTIONS,
  EVAL_SCENARIOS,
  EVAL_TODAY,
  EVAL_TODAY_FIRST,
  gradeRun,
  type EvalRun,
} from './model-eval';

/**
 * The model eval's Today scenario (plan step 6b): "ilk yapmam gereken ne?"
 * asked on Today reads get_today and names its first focus card by its title
 * and code, never the Actions list's first in its place.
 */

const run = (over: Partial<EvalRun>): EvalRun => ({
  status: 'done',
  answer: '',
  reads: [],
  changes: [],
  cards: 0,
  asks: 0,
  denials: 0,
  leaked: [],
  tokens: { input: 0, output: 0 },
  ...over,
});
const scenario = EVAL_SCENARIOS.find((s) => s.id === 'today-first-action')!;
const failed = (over: Partial<EvalRun>) =>
  gradeRun(scenario, run(over))
    .checks.filter((c) => !c.ok)
    .map((c) => `${c.must ? 'must' : 'review'}: ${c.name}`);

describe('the Today scenario', () => {
  it('is asked on Today, which answers with its focus, first card first', () => {
    expect(scenario).toMatchObject({
      message: 'ilk yapmam gereken ne?',
      context: { route: '/dashboard/action-center/today' },
    });
    expect(scenario.readResult!('get_today', { brand_id: 'b1' })).toBe(EVAL_TODAY);
    expect(EVAL_TODAY.focus.cards[0]).toMatchObject(EVAL_TODAY_FIRST);
    // Not the Actions list's first: an answer from that list names another action.
    expect(EVAL_ACTIONS[0].title).not.toBe(EVAL_TODAY_FIRST.title);
  });

  it('passes the first focus card named by its title and code, read from Today', () => {
    expect(
      failed({
        reads: ['get_today'],
        answer: `İlk iş: **${EVAL_TODAY_FIRST.title}** (${EVAL_TODAY_FIRST.ref}). İlk adım /pricing sayfasına bir karşılaştırma tablosu eklemek.`,
      }),
    ).toEqual([]);
  });

  it("fails an answer from the Actions list's order, or one that doesn't read Today", () => {
    expect(
      failed({
        reads: ['list_action_center_tasks'],
        answer: `İlk yapman gereken: **${EVAL_ACTIONS[0].title}** (${EVAL_ACTIONS[0].ref}). Bu aksiyon en yüksek öncelik puanına sahip.`,
      }),
    ).toEqual([
      'must: reads Today',
      'must: names the first focus card by its title',
      'must: names its code',
      "review: doesn't put the Actions list's first in its place",
    ]);
  });
});
