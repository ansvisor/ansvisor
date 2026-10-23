import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function render(suggestions: DraftSuggestion[], working = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentCard
          suggestions={suggestions}
          rules={rules}
          busy={false}
          working={working}
          {...handlers}
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
