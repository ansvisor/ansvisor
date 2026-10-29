import { describe, expect, it } from 'vitest';
import { actionsByKind, calibrate, parseRows, renderReport } from './detector-calibration.js';

/** Detector thresholds against what their actions did (learning C6). */

/**
 * One export line per action: strength n (as the signal's change), and how
 * the action ended, from `end(n)`.
 */
function lines(kind, from, to, end) {
  const out = [];
  for (let n = from; n <= to; n += 1) {
    const [status, outcome = 'pending_measurement', dismissReason = null] = end(n);
    out.push(
      JSON.stringify({ action: `${kind}-${n}`, kind, change: -n, status, outcome, dismissReason }),
    );
  }
  return out;
}
const rowsOf = (...groups) => parseRows(groups.flat().join('\n')).rows;
const kindOf = (report, kind) => report.kinds.find((k) => k.kind === kind);

describe('parseRows', () => {
  it('reads strength from the change, else the value, and counts lines that are not rows', () => {
    const { rows, skipped } = parseRows(
      [
        '﻿{"action":"a1","kind":"prompt_lost","change":-12,"current":3,"status":"completed","outcome":"improved"}',
        '{"action":"a2","kind":"prompt_lost","change":null,"current":"0.4","status":"dismissed","outcome":"pending_measurement","dismissReason":"not_now"}',
        '{"action":"a3","kind":"prompt_lost","status":"completed"}',
        '',
        'not json',
        '{"action":"a4"}',
        '{"kind":"prompt_lost"}',
      ].join('\r\n'),
    );
    expect(skipped).toBe(3);
    expect(rows).toEqual([
      {
        action: 'a1',
        kind: 'prompt_lost',
        strength: 12,
        status: 'completed',
        outcome: 'improved',
        dismissReason: null,
      },
      {
        action: 'a2',
        kind: 'prompt_lost',
        strength: 0.4,
        status: 'dismissed',
        outcome: 'pending_measurement',
        dismissReason: 'not_now',
      },
      {
        action: 'a3',
        kind: 'prompt_lost',
        strength: null,
        status: 'completed',
        outcome: null,
        dismissReason: null,
      },
    ]);
  });
});

describe('actionsByKind', () => {
  it("keeps one row per action and kind, its strongest signal's", () => {
    const rows = rowsOf([
      '{"action":"a1","kind":"k","change":2,"status":"completed"}',
      '{"action":"a1","kind":"k","change":-9,"status":"completed"}',
      '{"action":"a1","kind":"other","change":1,"status":"completed"}',
      '{"action":"a2","kind":"k","change":1,"status":"dismissed"}',
    ]);
    const byKind = actionsByKind(rows);
    expect(byKind.get('k').map((r) => [r.action, r.strength])).toEqual([
      ['a1', 9],
      ['a2', 1],
    ]);
    expect(byKind.get('other')).toHaveLength(1);
  });
});

describe('calibrate', () => {
  it('says nothing of a kind with fewer than 20 actions', () => {
    const report = calibrate(rowsOf(lines('k', 1, 19, () => ['completed', 'improved'])));
    expect(report.kinds).toEqual([]);
    expect(report.insufficient).toEqual([{ kind: 'k', actions: 19 }]);
  });

  it('suggests a threshold where the weakest quarter is mostly dismissed', () => {
    const report = calibrate(
      rowsOf(
        lines('k', 1, 20, (n) =>
          n <= 5 ? ['dismissed', 'pending_measurement', 'not_relevant'] : ['completed', 'improved'],
        ),
      ),
    );
    const k = kindOf(report, 'k');
    expect(k).toMatchObject({
      actions: 20,
      measured: 15,
      improved: 15,
      dismissed: 5,
      verdict: 'raise',
      suggestion: 5,
    });
    expect(k.dismissReasons).toEqual({
      not_relevant: 5,
      already_done: 0,
      wrong_data: 0,
      not_now: 0,
    });
    expect(k.buckets.map((b) => [b.upTo, b.actions])).toEqual([
      [5, 5],
      [10, 5],
      [15, 5],
      [20, 5],
    ]);
  });

  it('suggests a threshold where the weakest quarter improves at most half as often', () => {
    const report = calibrate(
      rowsOf(
        lines('k', 1, 20, (n) =>
          n <= 5 ? ['completed', 'no_meaningful_change'] : ['completed', 'improved'],
        ),
      ),
    );
    expect(kindOf(report, 'k')).toMatchObject({ verdict: 'raise', suggestion: 5 });
  });

  it('calls a kind quiet when under 10% of its results improved, evenly', () => {
    const report = calibrate(
      rowsOf(lines('k', 1, 20, (n) => ['completed', n === 10 ? 'improved' : 'declined'])),
    );
    expect(kindOf(report, 'k')).toMatchObject({ verdict: 'quiet', suggestion: null });
    expect(kindOf(report, 'k').outcomes).toMatchObject({ improved: 1, declined: 19 });
  });

  it('keeps a threshold when no quarter stands out', () => {
    const report = calibrate(
      rowsOf(lines('k', 1, 20, (n) => ['completed', n % 2 ? 'improved' : 'declined'])),
    );
    expect(kindOf(report, 'k')).toMatchObject({ verdict: 'keep', improvedRate: 0.5 });
  });

  it('suggests nothing when every signal was as strong', () => {
    const rows = rowsOf(
      lines('k', 1, 20, (n) =>
        n <= 15 ? ['dismissed', 'pending_measurement', 'wrong_data'] : ['completed', 'improved'],
      ),
    ).map((r) => ({ ...r, strength: 3 }));
    expect(kindOf(calibrate(rows), 'k')).toMatchObject({ verdict: 'keep', suggestion: null });
  });

  it('counts a result only for a completed action, as the Scorecard does', () => {
    const report = calibrate(
      rowsOf(
        lines('k', 1, 20, (n) => (n <= 10 ? ['dismissed', 'improved'] : ['completed', 'declined'])),
      ),
    );
    expect(kindOf(report, 'k')).toMatchObject({ measured: 10, improved: 0, dismissed: 10 });
  });

  it('takes a lower minimum', () => {
    const report = calibrate(rowsOf(lines('k', 1, 8, () => ['completed', 'improved'])), {
      min: 5,
    });
    expect(report.kinds.map((k) => k.kind)).toEqual(['k']);
  });
});

describe('renderReport', () => {
  it("prints aggregates, the suggestion and the kinds too small to say, never an action's id", () => {
    const rows = rowsOf(
      lines('prompt_lost', 1, 20, (n) =>
        n <= 5 ? ['dismissed', 'pending_measurement', 'not_relevant'] : ['completed', 'improved'],
      ),
      lines('topic_gap', 1, 4, () => ['completed', 'improved']),
    );
    const text = renderReport(calibrate(rows), { skipped: 2 });
    expect(text).toContain('## prompt_lost');
    expect(text).toContain('consider a threshold near 5');
    expect(text).toContain('Dismissed because: not_relevant 5');
    expect(text).toContain('Too few closed actions to say (under 20): topic_gap (4)');
    expect(text).toContain("2 line(s) of the export weren't rows");
    expect(text).not.toMatch(/prompt_lost-\d/);
    expect(JSON.stringify(calibrate(rows))).not.toMatch(/prompt_lost-\d/);
  });
});
