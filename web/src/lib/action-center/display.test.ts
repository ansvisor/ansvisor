import { describe, expect, it } from 'vitest';
import { actionGoal, actionTexts, eventTaskText, humanizeKind, taskText } from './display';
import { ACTION_KINDS } from './registry';
import type { ActionItem } from '@/lib/actions/action-center';
import messages from '../../../messages/en.json';

/** Resolves an actionCenter.actionTexts key the way next-intl would, minus
 *  the ICU formatting — enough to prove a key exists and is reached. */
const t = (key: string, values?: Record<string, string | number>) => {
  const scope: Record<string, unknown> = key.includes('.')
    ? (messages.actionCenter.actionTexts as unknown as Record<string, unknown>)
    : (messages.actionCenter.actionTasks as unknown as Record<string, unknown>);
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], scope);
  if (typeof value !== 'string') throw new Error(`missing message: ${key}`);
  // Enough ICU to prove the value reached the message; next-intl does the
  // real formatting at runtime.
  return value.replace(/\{\s*(\w+)\s*\}/g, (match, name) =>
    values && name in values ? String(values[name]) : match,
  );
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

describe('taskText', () => {
  /** Nothing about a planned task's text is stored — only which message it
   *  is and what it names — so the plan survives translation. */
  it('renders the target variant when the planner resolved one', () => {
    const text = taskText(
      {
        taskKey: 'compare_platforms',
        title: null,
        titleParams: { platform: 'gemini-web', bestPlatform: 'chatgpt-web' },
      },
      t,
    );

    expect(text).toContain('gemini-web');
    expect(text).toContain('chatgpt-web');
  });

  it('falls back to the plain message when nothing was resolvable', () => {
    expect(taskText({ taskKey: 'compare_platforms', title: null, titleParams: {} }, t)).toBe(
      messages.actionCenter.actionTasks.compare_platforms,
    );
  });

  it('treats a task with no params at all like one with empty params', () => {
    expect(taskText({ taskKey: 'validate', title: null }, t)).toBe(
      messages.actionCenter.actionTasks.validate,
    );
  });

  /** A title someone typed wins over any template, params or not. */
  it('prefers what the user wrote', () => {
    expect(
      taskText({ taskKey: 'validate', title: 'Ask the agency', titleParams: { a: 1 } }, t),
    ).toBe('Ask the agency');
  });

  it('renders nothing for a task with neither a title nor a key', () => {
    expect(taskText({ taskKey: null, title: null }, t)).toBe('');
  });
});

/**
 * Events carry a task's key, not its text: an event records what happened,
 * and the text is a rendering choice that may change afterwards.
 */
describe('eventTaskText', () => {
  const withHas = Object.assign((key: string) => t(key), {
    has: (key: string) => key in messages.actionCenter.actionTasks,
  });

  it('renders the task in the reader’s language', () => {
    expect(eventTaskText('validate', withHas)).toBe(messages.actionCenter.actionTasks.validate);
  });

  /** A task this build has no copy for still has to read as a sentence. */
  it('humanises a key it has no copy for', () => {
    expect(eventTaskText('seize_the_means', withHas)).toBe('seize the means');
  });

  it('renders nothing when the event named no task', () => {
    expect(eventTaskText(undefined, withHas)).toBe('');
    expect(eventTaskText('', withHas)).toBe('');
    expect(eventTaskText(42, withHas)).toBe('');
  });
});
