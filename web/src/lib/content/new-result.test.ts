import { describe, expect, it } from 'vitest';
import { newResultMessage } from './new-result';

const scope = (over = {}) => ({
  focus: 'auto' as const,
  requested: 3,
  needs: 10,
  covered: 0,
  noAnswers: 0,
  ...over,
});

describe('newResultMessage', () => {
  it('says the monthly limit was reached', () => {
    expect(newResultMessage({ generated: 0, limited: true })).toMatchObject({
      tone: 'error',
      title: { key: 'newLimitReached' },
    });
  });

  it('points at the open opportunity a prompt already has', () => {
    expect(newResultMessage({ generated: 0, existingId: 'o9', scope: scope() })).toMatchObject({
      title: { key: 'newExisting' },
      existingId: 'o9',
    });
  });

  it('counts what was created when everything asked for came back', () => {
    expect(newResultMessage({ generated: 3, duplicates: 0, scope: scope() })).toEqual({
      tone: 'success',
      title: { key: 'newDone', values: { generated: 3, duplicates: 0 } },
      reasons: [],
    });
  });

  it('says why only 1 of 3 came back: the other needs already have opportunities', () => {
    expect(newResultMessage({ generated: 1, scope: scope({ needs: 11, covered: 10 }) })).toEqual({
      tone: 'success',
      title: { key: 'newPartial', values: { generated: 1, requested: 3 } },
      reasons: [{ key: 'newReason.covered', values: { count: 10, focus: 'auto' } }],
    });
  });

  it('says a topic with nothing new is fully covered, not that it failed', () => {
    expect(
      newResultMessage({ generated: 0, scope: scope({ focus: 'topic', needs: 4, covered: 4 }) }),
    ).toEqual({
      tone: 'info',
      title: { key: 'newNone' },
      reasons: [{ key: 'newReason.covered', values: { count: 4, focus: 'topic' } }],
    });
  });

  it('tells needs without tracked answers apart from covered ones', () => {
    const { reasons } = newResultMessage({
      generated: 0,
      scope: scope({ focus: 'topic', needs: 3, covered: 1, noAnswers: 2 }),
    });
    expect(reasons.map((r) => r.key)).toEqual(['newReason.noAnswers', 'newReason.covered']);
    expect(reasons[0].values).toEqual({ count: 2 });
  });

  it('adds up the needs folded into existing opportunities', () => {
    const { reasons } = newResultMessage({
      generated: 1,
      merged: 1,
      duplicates: 1,
      sameQuestion: 0,
      scope: scope({ needs: 3 }),
    });
    expect(reasons).toEqual([{ key: 'newReason.joined', values: { count: 2 } }]);
  });

  it('says the focus has fewer needs than were asked for', () => {
    expect(newResultMessage({ generated: 1, scope: scope({ needs: 1 }) }).reasons).toEqual([
      { key: 'newReason.fewNeeds', values: { count: 1, focus: 'auto' } },
    ]);
  });

  it('says the model wrote fewer when nothing else held the rest back', () => {
    expect(newResultMessage({ generated: 2, scope: scope() }).reasons).toEqual([
      { key: 'newReason.fewerWritten' },
    ]);
  });

  it('names the needs written as another angle', () => {
    expect(
      newResultMessage({
        generated: 3,
        angles: [
          { need: 'Coffee gifts', of: 'Gift guide' },
          { need: 'Decaf', of: 'Decaf guide' },
        ],
        scope: scope({ needs: 11, covered: 10 }),
      }),
    ).toEqual({
      tone: 'success',
      title: { key: 'newDone', values: { generated: 3, duplicates: 0 } },
      reasons: [{ key: 'newReason.angles', values: { count: 2, needs: 'Coffee gifts, Decaf' } }],
    });
  });

  it('still says why when angles did not fill the rest', () => {
    const { title, reasons } = newResultMessage({
      generated: 2,
      angles: [{ need: 'Decaf', of: 'Decaf guide' }],
      scope: scope({ needs: 11, covered: 10 }),
    });
    expect(title).toEqual({ key: 'newPartial', values: { generated: 2, requested: 3 } });
    expect(reasons.map((r) => r.key)).toEqual(['newReason.angles', 'newReason.covered']);
  });

  it('keeps the old wording for a result without a scope', () => {
    expect(newResultMessage({ generated: 0, duplicates: 0 }).title).toEqual({ key: 'newNothing' });
    expect(newResultMessage({ generated: 0, duplicates: 2 }).title).toEqual({
      key: 'newDone',
      values: { generated: 0, duplicates: 2 },
    });
  });
});
