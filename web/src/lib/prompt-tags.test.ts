import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_TAGS, planBulkTagChange } from './prompt-tags';

/**
 * The bulk tag change's arithmetic (#2378): add and remove keep each
 * prompt's own tags, a prompt at the cap is skipped and counted, never
 * silently trimmed, and a no-op is said rather than written.
 */

const p = (id: string, tags: string[]) => ({ id, tags });

describe('planBulkTagChange (#2378)', () => {
  it('adds only the tags a prompt is missing', () => {
    const plan = planBulkTagChange(
      [p('p1', ['campaign-x']), p('p2', ['campaign-x', 'priority', 'bottom-funnel'])],
      'add',
      ['campaign-x', 'priority'],
    );

    expect(plan).toEqual({
      changes: [{ promptId: 'p1', tags: ['campaign-x', 'priority'] }],
      unchanged: 1,
      blocked: 0,
    });
  });

  it('skips a prompt the add would take past the cap, and trims nothing', () => {
    const full = Array.from({ length: MAX_PROMPT_TAGS }, (_, i) => `t${i + 1}`);
    const plan = planBulkTagChange([p('p1', full), p('p2', ['t1'])], 'add', ['new-tag']);

    expect(plan.changes).toEqual([{ promptId: 'p2', tags: ['t1', 'new-tag'] }]);
    expect(plan.blocked).toBe(1);
    expect(plan.unchanged).toBe(0);
  });

  it('takes the tags off, counting prompts without them as unchanged', () => {
    const plan = planBulkTagChange(
      [p('p1', ['campaign-x', 'priority']), p('p2', ['campaign-y'])],
      'remove',
      ['campaign-x', 'priority'],
    );

    expect(plan).toEqual({
      changes: [{ promptId: 'p1', tags: [] }],
      unchanged: 1,
      blocked: 0,
    });
  });

  it('cleans the input like the edit dialog: trim, dedupe, cap', () => {
    const plan = planBulkTagChange([p('p1', [])], 'add', [' q4 ', 'q4', '', 'x'.repeat(60)]);

    expect(plan.changes).toEqual([{ promptId: 'p1', tags: ['q4', 'x'.repeat(50)] }]);
  });

  it('changes nothing for an empty tag list', () => {
    const plan = planBulkTagChange([p('p1', ['a'])], 'add', []);

    expect(plan).toEqual({ changes: [], unchanged: 0, blocked: 0 });
  });

  it('reads a prompt without tags as empty, never as null trouble', () => {
    const plan = planBulkTagChange([{ id: 'p1', tags: null }], 'add', ['a']);

    expect(plan.changes).toEqual([{ promptId: 'p1', tags: ['a'] }]);
  });
});
