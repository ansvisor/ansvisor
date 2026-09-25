import { describe, expect, it } from 'vitest';
import { actionGoal, actionTexts, humanizeKind } from './display';
import { ACTION_KINDS } from './registry';
import type { ActionItem } from '@/lib/actions/action-center';
import messages from '../../../messages/en.json';

/** Resolves an actionCenter.actionTexts key the way next-intl would, minus
 *  the ICU formatting — enough to prove a key exists and is reached. */
const t = (key: string) => {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages.actionCenter.actionTexts,
    );
  if (typeof value !== 'string') throw new Error(`missing message: ${key}`);
  return value;
};

const action = (over: Partial<ActionItem>) =>
  ({
    kind: 'recover_visibility',
    category: 'recover',
    payload: {},
    signalCount: 1,
    ...over,
  }) as ActionItem;

describe('actionTexts', () => {
  it.each(ACTION_KINDS)('has written copy for %s', (kind) => {
    expect(() => actionTexts(action({ kind }), t)).not.toThrow();
    expect(() => actionGoal(kind, t)).not.toThrow();
  });

  /**
   * The server's definition registry grows on its own release cycle, so the
   * web will meet kinds it has never heard of. Hiding them was the old
   * behaviour and the wrong one: the work is real, and a row nobody can read
   * still beats a row nobody sees.
   */
  it('presents a kind it has never heard of rather than failing on it', () => {
    const texts = actionTexts(action({ kind: 'seize_the_means', category: 'growth' }), t);

    expect(texts.title).toBe('Seize the means');
    expect(texts.description).toBe(messages.actionCenter.actionTexts.unknown.description);
    expect(actionGoal('seize_the_means', t)).toBe(messages.actionCenter.actionTexts.unknown.goal);
  });
});

describe('humanizeKind', () => {
  it('reads a definition id as the phrase it was written to be', () => {
    expect(humanizeKind('expand_platform_visibility')).toBe('Expand platform visibility');
  });

  it('leaves a single word alone but for its capital', () => {
    expect(humanizeKind('recover')).toBe('Recover');
  });
});
