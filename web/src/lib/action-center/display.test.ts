import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  actionContextTags,
  actionEventText,
  actionGoal,
  actionTexts,
  eventTaskText,
  humanizeKind,
  taskText,
} from './display';
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
  // real formatting at runtime. Plurals collapse to their `other` branch.
  return value
    .replace(/\{(\w+), plural, one \{[^}]*\} other \{([^}]*)\}\}/g, (_m, name, other) =>
      String(other).replace('#', String(values?.[name] ?? '')),
    )
    .replace(/\{\s*(\w+)\s*\}/g, (match, name) =>
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

  it('holds copy for all sixty-two definitions and the four person-sent kinds', () => {
    expect(ACTION_KINDS).toHaveLength(66);
  });

  it('names a topic opportunity after its topic and demand (VIS-011)', () => {
    const payload = { topicName: 'GEO tools for agencies', demand: 92_000 };
    expect(actionTexts(action({ kind: 'topic_opportunity', payload }), t).title).toBe(
      'Capture ~92k/mo of AI demand in GEO tools for agencies',
    );
    const tags = actionContextTags(
      action({ kind: 'topic_opportunity', payload, signalCount: 0 }),
      (key: string) => key,
    );
    expect(tags).not.toContain('tags.signals');
  });

  it('names a topic gap after its topic, competitor and gap (VIS-010)', () => {
    const payload = { topicName: 'AI Rank Tracker', competitorName: 'Peec AI', gap: 26.5 };
    expect(actionTexts(action({ kind: 'topic_competitor_gap', payload }), t).title).toBe(
      'Close the 26.5-pt gap with Peec AI in AI Rank Tracker',
    );
    // Sent by a person: no "0 signals" chip.
    const tags = actionContextTags(
      action({ kind: 'topic_competitor_gap', payload, signalCount: 0 }),
      (key: string) => key,
    );
    expect(tags).not.toContain('tags.signals');
  });

  it('names an Improve action after its prompt, with its own why and goal', () => {
    const payload = {
      title: 'Improve position: "best coffee"',
      why: 'Not mentioned on Perplexity.',
      goal: 'Get the brand mentioned early and cited for "best coffee" on Perplexity.',
    };
    const texts = actionTexts(action({ kind: 'prompt_improve', payload }), t);
    expect(texts).toEqual({ title: payload.title, description: payload.why });
    expect(actionGoal('prompt_improve', t, payload)).toBe(payload.goal);
    expect(actionGoal('prompt_improve', t)).toBe(
      messages.actionCenter.actionTexts.prompt_improve.goal,
    );
  });

  it('names an opportunity action after the work it was sent for', () => {
    const texts = actionTexts(
      action({ kind: 'content_opportunity', payload: { title: 'Expand the tool list' } }),
      t,
    );
    expect(texts.title).toBe('Expand the tool list');
  });

  /**
   * The specification's title rule: "Recover 7 lost citations", never
   * "Recover citations". Every definition's title names its targets.
   */
  it.each(ACTION_KINDS)('%s names its targets in the title', (kind) => {
    const texts = actionTexts(
      action({ kind, payload: { targetCount: 7, targetEntity: 'prompts' } }),
      t,
    );
    if (messages.actionCenter.actionTexts[kind].title.includes('{targets}')) {
      expect(texts.title).toContain('7 prompts');
    }
  });

  /** An action raised before the library has no targets on its payload, and
   *  must not read "0 prompts". */
  it('falls back to a title without a count', () => {
    const texts = actionTexts(action({ kind: 'recover_lost_citations', payload: {} }), t);
    expect(texts.title).toBe(messages.actionCenter.actionTexts.recover_lost_citations.titleGeneric);
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
  it('names what a library task acts on', () => {
    expect(
      taskText(
        {
          taskKey: 'analyze_citations',
          title: null,
          titleParams: { count: 11, entity: 'sources' },
        },
        t,
      ),
    ).toBe('Analyze citations across 11 sources');
  });

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

describe('actionEventText', () => {
  const page = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionsPage' });
  const tPage = (key: string, values?: Record<string, string | number>) =>
    page(key as Parameters<typeof page>[0], values);
  const event = (name: string, data: Record<string, unknown>) => ({
    id: 'e1',
    event: name,
    data,
    actorId: null,
    createdAt: '2026-10-16T00:00:00Z',
  });

  it('reads the 30-day position result with its counts', () => {
    expect(
      actionEventText(event('position_outcome_recorded', { improved: 2, measurable: 3 }), tPage, t),
    ).toBe('30-day result: position improved on 2 of 3 platforms');
    expect(
      actionEventText(event('position_outcome_recorded', { improved: 0, measurable: 0 }), tPage, t),
    ).toBe('30-day result: not enough data to compare positions');
  });

  it("passes a task's own title and the measured verdict", () => {
    expect(actionEventText(event('task_added', { title: 'Ask the agency' }), tPage, t)).toBe(
      'Task added: “Ask the agency”',
    );
    expect(actionEventText(event('outcome_measured', { outcome: 'improved' }), tPage, t)).toBe(
      'Result: metrics improved after this action closed',
    );
  });
});

/**
 * Every event written to an action's trail is a line in the drawer's History
 * tab, and an event with no message there shows next-intl's missing-message
 * text instead. The events are read from the source that writes them — the
 * server actions and the Node server's Action Center engine — so one added
 * there without copy fails here, not in the drawer.
 */
describe('History events', () => {
  const source = readFileSync(join(__dirname, '../actions/action-center.ts'), 'utf8');
  const logged = [...source.matchAll(/logEvent\(\s*\w+,\s*\w+,\s*'(\w+)'/g)].map(
    (match) => match[1],
  );

  // The engine writes through a `logEvent(actionId, 'event', …)` helper or
  // inserts the row itself with `event: 'event'`.
  const engineDir = join(__dirname, '../../../../server/src/lib/action-center');
  const written = readdirSync(engineDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'))
    .flatMap((file) => [
      ...readFileSync(join(engineDir, file), 'utf8').matchAll(
        /logEvent\(\s*[\w.]+,\s*'(\w+)'|event: '(\w+)'/g,
      ),
    ])
    .map((match) => match[1] ?? match[2]);

  const tPage = createTranslator({
    locale: 'en',
    messages,
    namespace: 'actionCenter.actionsPage',
    onError: (error) => {
      throw error;
    },
  });
  /** The values the drawer formats every event with. */
  const values = {
    to: 'done',
    count: 2,
    task: 'Validate the change',
    tool: 'site_audit',
    improved: 1,
    measurable: 2,
    title: 'Ask the agency',
    outcome: 'improved',
  };
  const eventText = (event: string, data: Partial<typeof values> = {}) =>
    tPage(`drawer.events.${event}` as Parameters<typeof tPage>[0], { ...values, ...data });

  /** A pattern that stopped matching would pass every check below by
   *  checking nothing. */
  it('reads the events the server actions log', () => {
    expect(logged).toEqual(
      expect.arrayContaining(['status_changed', 'task_added', 'task_renamed', 'task_deleted']),
    );
  });

  it('reads the events the Node server writes', () => {
    expect(written).toEqual(
      expect.arrayContaining([
        'created',
        'signals_linked',
        'task_ran',
        'task_run_failed',
        'task_awaiting_approval',
        'position_outcome_recorded',
        'outcome_measured',
      ]),
    );
  });

  it.each([...new Set([...logged, ...written])])('has a History line for %s', (event) => {
    expect(() => eventText(event)).not.toThrow();
  });

  /** The validation sweep records one of four verdicts, and each reads in
   *  words — "after this action closed", never "because of it". */
  it.each([
    ['improved', 'Result: metrics improved after this action closed'],
    ['declined', 'Result: metrics declined after this action closed'],
    ['no_meaningful_change', 'Result: no meaningful change in metrics after this action closed'],
    ['not_measurable', 'Result: could not be measured'],
  ])('says what the measurement found: %s', (outcome, text) => {
    expect(eventText('outcome_measured', { outcome })).toBe(text);
  });

  /** A verdict this build has no words for still reads as a result. */
  it('reads an unknown or missing verdict as a plain result', () => {
    expect(eventText('outcome_measured', { outcome: 'pending_measurement' })).toBe(
      'Result measured',
    );
    expect(eventText('outcome_measured', { outcome: '' })).toBe('Result measured');
  });

  /** A task someone added or renamed is named as they typed it. */
  it('names the task in its own words', () => {
    expect(eventText('task_added')).toBe('Task added: “Ask the agency”');
    expect(eventText('task_renamed')).toBe('Task renamed to “Ask the agency”');
    expect(eventText('task_deleted')).toBe('Task deleted');
  });
});
