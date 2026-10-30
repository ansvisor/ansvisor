import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatStep } from '@/lib/chat/events';
import { emptyRun, type ClientRun } from '@/lib/chat/run-state';

// The result card's module, where the stamp comes from, links with the app's navigation.
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));

const { RunAnswer } = await import('./run-answer');

/**
 * An answer as its run works (W1-14, CHAT-03 12a–14): the status line from
 * the running step, ✓ chips of the steps done (the fact check among them),
 * the streamed text, Data used and the stamp, and what follows only once done.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const steps: ChatStep[] = [
  { n: 1, kind: 'thinking', label: 'Thinking', status: 'done' },
  {
    n: 2,
    kind: 'read',
    label: 'Read Citations',
    status: 'done',
    detail: 'Perplexity · Last 30 days · 42 rows',
    rowCount: 42,
  },
  { n: 3, kind: 'open_page', label: 'Opened ansvisor.com/pricing', status: 'done' },
  {
    n: 4,
    kind: 'check',
    label: 'Checked facts',
    status: 'done',
    detail: 'Every figure matches the data',
  },
];

const run = (over: Partial<ClientRun>): ClientRun => ({ ...emptyRun('running'), ...over });

async function render(props: Partial<Parameters<typeof RunAnswer>[0]> & { run: ClientRun }) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RunAnswer workingMs={41_000} timezone="UTC" {...props} />
      </NextIntlClientProvider>,
    );
  });
}
const status = () => container.querySelector('[data-slot="run-status"]')?.textContent ?? null;
const chips = () =>
  [...container.querySelectorAll('[data-action="answer.openStep"]')].map((c) => c.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RunAnswer', () => {
  it('says what the running step does, and thinks with none', async () => {
    await render({
      run: run({
        steps: [{ n: 1, kind: 'read', label: 'Read Citations', status: 'running' }],
      }),
    });
    expect(status()).toBe('Reading Citations…');
    expect(container.textContent).toContain('Working on it');

    await render({ run: run({ status: 'queued' }) });
    expect(status()).toBe('Thinking…');

    await render({ run: run({ steps, text: 'Two pages lost most of it.' }) });
    expect(status()).toBe('Writing the answer…');
  });

  it('chips the steps done, the fact check among them, with each detail a click away', async () => {
    await render({ run: run({ steps, text: 'Two pages lost most of it.' }) });
    expect(chips()).toEqual([
      'Read Citations · 42 rows',
      'Opened ansvisor.com/pricing',
      'Checked facts',
    ]);
    const check = container.querySelectorAll<HTMLButtonElement>(
      '[data-action="answer.openStep"]',
    )[2];
    await act(async () => check.click());
    expect(check.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Every figure matches the data');
  });

  it('names the data used, stamps the answer, and shows what follows once done', async () => {
    await render({
      run: run({
        status: 'done',
        steps,
        text: 'Two pages lost most of it.',
        generatedAt: '2026-10-30T09:14:00.000Z',
        dataAsOf: '2026-10-29T23:00:00.000Z',
      }),
      footer: <p>Next moves</p>,
    });
    expect(status()).toBeNull();
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(container.textContent).toContain('Data usedCitations · 42 rowsansvisor.com/pricing');
    expect(container.textContent).toContain(
      'Generated Oct 30, 2026 · 09:14 · Data as of Oct 29, 2026, 23:00',
    );
    expect(container.textContent).toContain('Worked for 41s');
    expect(container.textContent).toContain('Next moves');
  });

  it('holds what follows while the run works, and says in its header when it reconnects', async () => {
    await render({ run: run({ steps }), footer: <p>Next moves</p>, reconnecting: true });
    expect(container.textContent).not.toContain('Next moves');
    const header = container.querySelector('[data-action="answer.toggleSteps"]')!;
    expect(header.textContent).toContain('Reconnecting…');
    // Said once: the status line doesn't repeat the header.
    expect(status()).not.toBe('Reconnecting…');

    // No steps yet, so no header: the status line says it.
    await render({ run: run({}), reconnecting: true });
    expect(status()).toBe('Reconnecting…');
  });

  it('says why a run failed with a red ×, and Retry sends its question again (W1-15)', async () => {
    const onRetry = vi.fn();
    const reason = "Chat couldn't check your AI usage just now, so it didn't start this step.";
    await render({
      run: run({ status: 'error', text: 'So far: two pages.', errorReason: reason }),
      onRetry,
    });
    const box = container.querySelector('[data-slot="run-error"]')!;
    // No steps, so no header: the box names it.
    expect(box.textContent).toContain('Stopped: something went wrong');
    expect(box.textContent).toContain(reason);
    expect(container.textContent).toContain('So far: two pages.');
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!.click(),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);

    // With steps, their header names it; the box gives the reason. No Retry without one.
    await render({
      run: run({
        status: 'error',
        steps: [
          { n: 1, kind: 'read', label: 'Read Citations', status: 'error', detail: 'Timed out' },
        ],
        errorReason: reason,
      }),
    });
    const failed = container.querySelector('[data-slot="run-error"]')!;
    expect(failed.textContent).toBe(reason);
    expect(failed.querySelector('[data-action="run.retry"]')).toBeNull();
    expect(container.querySelector('[data-action="answer.toggleSteps"]')!.textContent).toContain(
      'Stopped: something went wrong',
    );
  });

  it('says "Stopped after 41s · 5 steps" after a Stop, its stopped step skipped, its text kept', async () => {
    await render({
      run: run({
        status: 'stopped',
        text: 'So far: two pages.',
        steps: [
          ...steps,
          { n: 5, kind: 'read', label: 'Read Mentions', status: 'skipped', detail: 'Stopped' },
        ],
        summary: { workingMs: 41_000, stepCount: 5, sources: [] },
      }),
    });
    const header = container.querySelector('[data-action="answer.toggleSteps"]')!;
    expect(header.textContent).toContain('Stopped after 41s');
    expect(header.textContent).toContain('5 steps');
    await act(async () => (header as HTMLButtonElement).click());
    const stopped = container.querySelector('[data-state="skipped"]')!;
    expect(stopped.textContent).toBe('5Read MentionsStopped');
    expect(container.textContent).toContain('So far: two pages.');
    expect(container.querySelector('[data-slot="run-error"]')).toBeNull();
  });
});
