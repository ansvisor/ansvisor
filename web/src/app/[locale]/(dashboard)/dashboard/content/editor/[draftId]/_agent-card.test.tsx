import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '@/lib/content/agent-runs';
import messages from '../../../../../../../../messages/en.json';
import type { DraftSuggestion } from '@/lib/content/suggestions';
import { AgentCard, rulesAfter, type CardRules } from './_agent-card';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const suggestion = (over: Partial<DraftSuggestion> = {}): DraftSuggestion => ({
  id: 's1',
  batchId: 'b1',
  actionId: null,
  actionNo: null,
  kind: 'replace',
  blockText: 'We delve into forecasting.',
  beforeText: 'delve into',
  afterText: 'look at',
  reason: 'remove an AI trace (rule)',
  ruleKeys: ['aiTraces'],
  status: 'open',
  ...over,
});

const rules: CardRules = { met: 9, total: 14, open: new Set(['aiTraces', 'summary', 'faq']) };

let container: HTMLDivElement;
let root: Root;
const handlers = {
  onAcceptAll: vi.fn(),
  onRejectAll: vi.fn(),
  onUndoAll: vi.fn(),
  onReview: vi.fn(),
  onRun: vi.fn(),
  onClose: vi.fn(),
  onDecidePage: vi.fn(),
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(handlers).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  suggestions: DraftSuggestion[],
  working = false,
  extra: Partial<Parameters<typeof AgentCard>[0]> = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentCard
          suggestions={suggestions}
          rules={rules}
          busy={false}
          working={working}
          {...handlers}
          {...extra}
        />
      </NextIntlClientProvider>,
    );
  });
}

const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent);
const click = (label: string) =>
  act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click(),
  );

describe('rulesAfter', () => {
  it('counts each open rule an open suggestion meets once', () => {
    expect(
      rulesAfter(
        [
          suggestion(),
          suggestion({ id: 's2', ruleKeys: ['aiTraces', 'summary'] }),
          // Decided, or a rule already met: no gain.
          suggestion({ id: 's3', ruleKeys: ['faq'], status: 'rejected' }),
          suggestion({ id: 's4', ruleKeys: ['sentence'] }),
        ],
        rules,
      ),
    ).toBe(11);
    expect(rulesAfter([suggestion()], { ...rules, met: 14 })).toBe(14);
  });
});

describe('AgentCard', () => {
  it('says how many suggestions wait, what they change and the rules they gain', async () => {
    await render([
      suggestion(),
      suggestion({ id: 's2', reason: 'add a summary', ruleKeys: ['summary'] }),
    ]);
    expect(container.textContent).toContain('Content Agent has 2 suggestions for you');
    expect(container.textContent).toContain(
      'Remove an AI trace (rule) · +1 more · Rules 9 → 11 of 14',
    );
    expect(buttons()).toEqual(['Review', 'Reject all', 'Accept all']);
    await click('Review');
    expect(handlers.onReview).toHaveBeenCalled();
    await click('Accept all');
    expect(handlers.onAcceptAll).toHaveBeenCalled();
  });

  it('once all are reviewed, says what was accepted and runs the agent again', async () => {
    await render([
      suggestion({ status: 'accepted' }),
      suggestion({ id: 's2', status: 'rejected' }),
    ]);
    expect(container.textContent).toContain('All suggestions reviewed');
    expect(container.textContent).toContain('1 accepted · Rules 9 of 14 · 5 still open');
    expect(buttons().slice(0, 2)).toEqual(['Undo all', 'Run Agent']);
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
    await click('Run Agent');
    expect(handlers.onRun).toHaveBeenCalled();
  });

  it("offers the Next step basket's step in Run Agent's place, with All steps", async () => {
    const onNext = vi.fn();
    const onAllSteps = vi.fn();
    const reviewed = [
      suggestion({ status: 'accepted' }),
      suggestion({ id: 's2', status: 'rejected' }),
    ];
    await render(reviewed, false, {
      next: { label: 'Rewrite page', onRun: onNext, blocked: null },
      onAllSteps,
    });
    expect(buttons().slice(0, 3)).toEqual(['Undo all', 'All steps', 'Next: Rewrite page']);
    await click('Next: Rewrite page');
    expect(onNext).toHaveBeenCalled();
    expect(handlers.onRun).not.toHaveBeenCalled();
    await click('All steps');
    expect(onAllSteps).toHaveBeenCalled();
    // With every rule met it still says what's next, and why it waits when it can't run.
    await render(reviewed, false, {
      rules: { ...rules, met: 14 },
      next: { label: 'Before you publish', onRun: onNext, blocked: 'Saving first.' },
      onAllSteps,
    });
    const nextButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Next: Before you publish',
    )!;
    expect(nextButton.disabled).toBe(true);
    expect(container.textContent).toContain('Saving first.');
    // Suggestions still to decide come first.
    await render([suggestion()], false, {
      next: { label: 'Rewrite page', onRun: onNext, blocked: null },
    });
    expect(buttons()).not.toContain('Next: Rewrite page');
  });

  it('heads with the Next step and who takes it, what the agent left as its last run', async () => {
    const reviewed = [suggestion({ status: 'accepted' })];
    const step = {
      label: 'Rewrite page',
      onRun: vi.fn(),
      blocked: null,
      title: 'Shorten to your Length',
      reason: '6,773 characters against a Length of 4,000.',
      actor: 'agent' as const,
    };
    await render(reviewed, false, { next: step });
    const card = container.querySelector('[role="region"]')!;
    expect(card.textContent).toContain('Next · Shorten to your Length');
    expect(card.textContent).toContain('Content Agent takes this step');
    expect(card.textContent).toContain('6,773 characters against a Length of 4,000.');
    expect(card.textContent).toContain('Last run: All suggestions reviewed · 1 accepted');
    // The agent's step: its robot.
    expect(card.querySelector('svg rect')).not.toBeNull();
    // The step changes, and so does the card: the person's step, the person's tile.
    await render(reviewed, false, {
      next: {
        ...step,
        label: 'Pick author',
        title: 'Add proof and author',
        reason: "Only you can do this: pick the page's author.",
        actor: 'you',
      },
    });
    expect(card.textContent).toContain('Next · Add proof and author');
    expect(card.textContent).toContain("Only you can do this: pick the page's author.");
    expect(card.textContent).toContain('only you can take this step');
    expect(card.querySelector('svg rect')).toBeNull();
    // The agent's suggestions still to decide keep its tile and their count in sight.
    await render([suggestion()], false, { next: { ...step, actor: 'you' } });
    expect(card.querySelector('svg rect')).not.toBeNull();
    // Working: the run, not the step.
    await render([], true, { next: step });
    expect(card.textContent).toBe('Content Agent is working');
    // A rewrite to decide: still under the step, with its own buttons.
    await render(
      [
        suggestion({
          kind: 'page',
          beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
          afterText: '<h1>New</h1><p>Shorter.</p>',
          reason: 'cut to the Length',
        }),
      ],
      false,
      { next: step },
    );
    expect(card.textContent).toContain('Next · Shorten to your Length');
    expect(card.textContent).toContain(
      'Last run: Content Agent rewrote the page to its rules · 37 → 12 characters · cut to the Length',
    );
    expect(buttons()).toEqual(['Compare', 'Reject', 'Accept']);
  });

  it('reads a rewrite against the Length, not the agent’s say, and says what it kept', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
      afterText: '<h1>New</h1><p>Shorter.</p>',
      reason: 'shortened the content to about 4 characters',
    });
    // 12 characters for a Length of 4 (3–5): missed, most of it kept.
    await render([page], false, { length: { target: 4, min: 3, max: 5, kept: 4 } });
    expect(container.textContent).toContain(
      '37 → 12 characters · Length 4 not reached (4 characters are passages AI answers quote, tables and other blocks a rewrite keeps as they are)',
    );
    expect(container.textContent).not.toContain('shortened the content');
    // Within the Length: the agent's own words.
    await render([page], false, { length: { target: 12, min: 10, max: 14, kept: 0 } });
    expect(container.textContent).toContain(
      '37 → 12 characters · shortened the content to about 4 characters',
    );
  });

  it('says it is working, with nothing to press', async () => {
    await render([], true);
    const card = container.querySelector('[role="region"]')!;
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.textContent).toBe('Content Agent is working');
    expect(buttons()).toEqual([]);
  });

  it('shows a page rewritten with its characters, to compare, reject or accept', async () => {
    const page = suggestion({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>A much longer page than this one.</p>',
      afterText: '<h1>New</h1><p>Shorter.</p>',
      reason: 'cut to the Length',
    });
    await render([page]);
    expect(container.textContent).toContain('Content Agent rewrote the page to its rules');
    expect(container.textContent).toContain('37 → 12 characters · cut to the Length');
    expect(buttons()).toEqual(['Compare', 'Reject', 'Accept']);
    await click('Accept');
    expect(handlers.onDecidePage).toHaveBeenCalledWith('accepted');
  });

  it('says how many of the person’s sources a batch or a rewrite was built from (CE-034)', async () => {
    const onSeeSources = vi.fn();
    const show = async (list: DraftSuggestion[]) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages}>
            <AgentCard
              suggestions={list}
              rules={rules}
              busy={false}
              working={false}
              sourceCount={3}
              onSeeSources={onSeeSources}
              {...handlers}
            />
          </NextIntlClientProvider>,
        );
      });
    await show([suggestion({})]);
    expect(container.textContent).toContain('built from 3 of your sources · See sources');
    await click('See sources');
    expect(onSeeSources).toHaveBeenCalledTimes(1);
    await show([
      suggestion({
        kind: 'page',
        beforeHtml: '<h1>Old</h1><p>Longer than this.</p>',
        afterText: '<h1>New</h1><p>Short.</p>',
        reason: 'cut to the Length',
      }),
    ]);
    expect(container.textContent).toContain(
      'cut to the Length · built from 3 of your sources · See sources',
    );
    // None named: nothing said.
    await render([suggestion({})]);
    expect(container.textContent).not.toContain('built from');
  });

  it('shows the run’s steps while working, done ones checked, and only Stop (CE-027/035)', async () => {
    const onStop = vi.fn();
    const run: AgentRun = {
      id: 'r1',
      kind: 'rewrite',
      steps: [
        { key: 'read_rules', count: 14 },
        { key: 'gather_sources', count: 52 },
        { key: 'rewrite_page', count: null },
        { key: 'check_sources', count: null },
      ],
      step: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stoppedAt: null,
      outcome: null,
    };
    const show = (stopping: boolean) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages}>
            <AgentCard
              suggestions={[]}
              rules={rules}
              busy={false}
              working
              run={run}
              onStop={onStop}
              stopping={stopping}
              {...handlers}
            />
          </NextIntlClientProvider>,
        );
      });
    await show(false);
    const steps = [...container.querySelectorAll('li')];
    expect(steps.map((li) => li.textContent)).toEqual([
      'Reading 14 rules',
      'Gathering 52 sources',
      'Rewriting the page',
      'Checking sources',
    ]);
    expect(steps[0].querySelector('svg')).not.toBeNull();
    expect(steps[1].querySelector('[aria-current="step"]')).not.toBeNull();
    expect(buttons()).toEqual(['Stop']);
    await click('Stop');
    expect(onStop).toHaveBeenCalledTimes(1);
    await show(true);
    expect(container.querySelector('button')!.disabled).toBe(true);
  });

  it('stops all of its motion with reduced motion, in every state', async () => {
    for (const [list, working] of [
      [[suggestion()], false],
      [[suggestion({ status: 'accepted' })], false],
      [[], true],
    ] as const) {
      await render([...list], working);
      const moving = [...container.querySelectorAll('[class*="animate-agent"]')];
      expect(moving.length).toBeGreaterThan(0);
      expect(
        moving.every((el) => /motion-reduce:(animate-none|hidden)/.test(el.getAttribute('class')!)),
      ).toBe(true);
    }
  });

  it('undoes a page rewrite rejected, and runs the agent on what is still open', async () => {
    await render([
      suggestion({
        kind: 'page',
        status: 'rejected',
        beforeHtml: '<p>Old.</p>',
        afterText: '<p>New.</p>',
      }),
    ]);
    expect(container.textContent).toContain('Rewrite rejected');
    await click('Undo');
    expect(handlers.onDecidePage).toHaveBeenCalledWith('open');
  });

  it('says why Run Agent waits, in the card, never only on hover', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <AgentCard
            suggestions={[suggestion({ status: 'accepted' })]}
            rules={rules}
            busy={false}
            working={false}
            runBlocked="Content Agent is already working on this page."
            {...handlers}
          />
        </NextIntlClientProvider>,
      );
    });
    const run = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Run Agent',
    )!;
    expect(run.disabled).toBe(true);
    expect(run.title).toBe('');
    const reason = container.querySelector(`[id="${run.getAttribute('aria-describedby')}"]`)!;
    expect(reason.textContent).toBe('Content Agent is already working on this page.');
    expect(reason.className).toContain('text-amber-700');
  });
});
