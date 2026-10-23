import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { nextStep, type NextStepState } from '@/lib/content/next-step';
import type { AgentRun } from '@/lib/content/agent-runs';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { NextStepButton, wordsUnderTitle } = await import('./_next-step');

/**
 * The Next step basket (Next step spec §2–3): the header's button names
 * the step; the popover gives why, its buttons, Skip, the path and the
 * "If you see…" lines, or the run under way with Stop.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const state = (over: Partial<NextStepState> = {}): NextStepState => ({
  method: 'create',
  open: true,
  published: false,
  hasBrief: true,
  empty: false,
  rewrite: null,
  openRules: [],
  quality: { trust: 72, trustLow: false, todos: [] },
  skipped: {},
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onAction = vi.fn();
const onSkip = vi.fn();
const onOpenChange = vi.fn();

async function render(
  s: NextStepState,
  {
    open = true,
    todoLine = null as string | null,
    blocked = (() => null) as (action: string) => string | null,
    working = null as { run: AgentRun | null; onStop: () => void; stopping: boolean } | null,
  } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NextStepButton
          next={nextStep(s)}
          state={s}
          todoLine={todoLine}
          open={open}
          onOpenChange={onOpenChange}
          focusOnOpen
          onAction={onAction}
          onSkip={onSkip}
          blocked={blocked}
          working={working}
        />
      </NextIntlClientProvider>,
    );
  });
}
const trigger = () => container.querySelector('button')!;
const popup = () => document.querySelector('[data-slot="popover-content"]');
const button = (name: string) =>
  [...(popup()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);
const path = () => [...popup()!.querySelectorAll('ol li')].map((li) => li.textContent);

beforeEach(() => {
  onAction.mockReset();
  onSkip.mockReset();
  onOpenChange.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('NextStepButton', () => {
  it('names the step on the header button and opens the basket on a click', async () => {
    await render(state({ hasBrief: false, empty: true }), { open: false });
    expect(trigger().getAttribute('aria-label')).toBe('Next · Plan the page');
    expect(trigger().textContent).toBe('Next· Plan the page');
    expect(popup()).toBeNull();
    await act(async () => trigger().click());
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('says why from the page, with its button, the other one and Skip', async () => {
    await render(
      state({
        method: 'optimize',
        rewrite: { reason: 'length', count: 19_203, target: 8_000, percent: 140 },
        openRules: ['rule0', 'rule1', 'rule2'],
      }),
    );
    expect(popup()!.textContent).toContain('Shorten to your Length');
    expect(popup()!.textContent).toContain(
      "19,203 characters against a Length of 8,000. Small fixes won't get there, so rewrite it in one go.",
    );
    await act(async () => button('Rewrite page')!.click());
    expect(onAction).toHaveBeenCalledWith('rewritePage');
    await act(async () => button('Fix open rules')!.click());
    expect(onAction).toHaveBeenCalledWith('fixRules');
    await act(async () => button('Skip')!.click());
    expect(onSkip).toHaveBeenCalledWith('length');
    expect(path()).toEqual([
      'Plan the page · done',
      'Bring in your page · done',
      '3Shorten to your Length · now',
      '4Add proof and author · to do',
      '5Check and mark ready · to do',
    ]);
    // If you see…: each line with its button, none repeating the step's own.
    expect(popup()!.textContent).not.toContain('Page far longer than Length');
    expect(popup()!.textContent).not.toContain('rules open →');
    // Fix open rules passed: the line names how few are open (the Rules tab's rewrite count less one).
    const few = state({ openRules: ['faq', 'summary'], skipped: { fixRules: 'faq,summary' } });
    await render(few);
    expect(popup()!.textContent).toContain('1 to 3 rules open → Fix open rules');
  });

  it('names the to-do only the person can do while Trust is low', async () => {
    await render(
      state({
        quality: {
          trust: 54,
          trustLow: true,
          todos: [{ id: 'byline', done: false, gain: 15, action: 'pickAuthor' }],
        },
      }),
      { todoLine: "pick the page's author" },
    );
    expect(popup()!.textContent).toContain(
      "Trust is 54, under 60. Only you can do this first: pick the page's author.",
    );
    await act(async () => button('Pick author')!.click());
    expect(onAction).toHaveBeenCalledWith('pickAuthor');
  });

  it("says why a button can't run now, and offers no Skip on the last step", async () => {
    await render(state({ openRules: ['rule0', 'rule1'] }), {
      blocked: (action) =>
        action === 'fixRules' ? 'Decide on the 2 open suggestions first.' : null,
    });
    expect(button('Fix open rules')!.disabled).toBe(true);
    expect(popup()!.textContent).toContain('Decide on the 2 open suggestions first.');
    await render(state());
    expect(popup()!.textContent).toContain('Check and mark ready');
    expect(button('Before you publish')).toBeDefined();
    expect(button('Skip')).toBeUndefined();
    // Published: Export, saying it went out.
    await render(state({ open: false, published: true }));
    expect(popup()!.textContent).toContain(
      "It's published. Export it again when the page changes.",
    );
    expect(button('Export')).toBeDefined();
  });

  it("moves focus to the next step's button after Skip, and reads the step out", async () => {
    const s = state({ openRules: ['faq'] });
    await render(s);
    await act(async () => button('Skip')!.click());
    expect(onSkip).toHaveBeenCalledWith('fixRules');
    // The editor passes the skip on: the step after it shows.
    await render({ ...s, skipped: { fixRules: 'faq' } });
    expect(document.activeElement).toBe(button('Before you publish'));
    expect(popup()!.querySelector('[aria-live="polite"]')!.textContent).toContain(
      'Check and mark ready',
    );
  });

  it('shows the run under way with Stop instead of a step', async () => {
    const onStop = vi.fn();
    await render(state({ openRules: ['rule0', 'rule1'] }), {
      working: {
        run: {
          id: 'r1',
          kind: 'fix',
          steps: [
            { key: 'read_rules', count: null },
            { key: 'write_changes', count: null },
          ],
          step: 1,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          stoppedAt: null,
          outcome: null,
        },
        onStop,
        stopping: false,
      },
    });
    expect(popup()!.textContent).toContain('Content Agent is working');
    expect(button('Fix open rules')).toBeUndefined();
    await act(async () => button('Stop')!.click());
    expect(onStop).toHaveBeenCalled();
  });
});

describe('wordsUnderTitle', () => {
  it('reads the words besides the block the title comes from', () => {
    expect(wordsUnderTitle('<h1>Pour-over</h1><p></p>')).toBe(false);
    expect(wordsUnderTitle('<h1>Pour-over</h1><p>Brew.</p>')).toBe(true);
    // An empty line or an image above the title changes nothing.
    expect(wordsUnderTitle('<p></p><h1>Pour-over</h1><p></p>')).toBe(false);
    expect(wordsUnderTitle('<p><img src="https://cdn.acme.com/a.jpg"></p><h1>Pour-over</h1>')).toBe(
      false,
    );
    // No H1: the first heading, else the first line, is the title.
    expect(wordsUnderTitle('<h2>Pour-over</h2><p>Brew.</p>')).toBe(true);
    expect(wordsUnderTitle('<p>Pour-over</p>')).toBe(false);
    expect(wordsUnderTitle('<p>Pour-over</p><p>Brew.</p>')).toBe(true);
    expect(wordsUnderTitle('')).toBe(false);
  });
});
