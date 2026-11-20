import { describe, expect, it } from 'vitest';
import { removedListOf, shouldReplan } from './removed-list';

const payload = (removed: number, created = 6) => ({
  targetEntity: 'prompts',
  targetCount: created - removed,
  createdTargetCount: created,
  removedCount: removed,
  removedLabels: [],
});

describe('removedListOf (AC-13)', () => {
  it('names each removed target, with why when the list says', () => {
    expect(
      removedListOf([
        { entity_key: 'p1', label: 'best crm', removed_reason: 'deleted' },
        { entity_key: 'p2', label: null, removed_reason: 'paused' },
        { entity_key: 'p3', label: 'crm for agents', removed_reason: null },
      ]),
    ).toEqual([
      { label: 'best crm', reason: 'deleted' },
      { label: 'p2', reason: 'paused' },
      { label: 'crm for agents', reason: null },
    ]);
  });
});

describe('shouldReplan (AC-13)', () => {
  const action = (over: Record<string, unknown> = {}, p: Record<string, unknown> = payload(4)) => ({
    kind: 'citation_loss',
    status: 'new',
    payload: p,
    ...over,
  });

  it('offers it once more than half of the prompts are gone and some are left', () => {
    expect(shouldReplan(action())).toBe(true);
    expect(shouldReplan(action({}, payload(3)))).toBe(false);
    expect(shouldReplan(action({}, payload(6)))).toBe(false);
  });

  it("doesn't for other lists, closed actions or ones whose tasks aren't rewritten", () => {
    expect(shouldReplan(action({}, { ...payload(4), targetEntity: 'pages' }))).toBe(false);
    expect(shouldReplan(action({ status: 'completed' }))).toBe(false);
    expect(shouldReplan(action({ kind: 'prompt_improve' }))).toBe(false);
    expect(shouldReplan(action({}, { targetEntity: 'prompts', targetCount: 6 }))).toBe(false);
  });
});
