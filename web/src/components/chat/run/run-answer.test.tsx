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

  it('links only http(s) addresses and pages of the app, and fetches no image', async () => {
    await render({
      run: run({
        status: 'done',
        text: [
          'See [the guide](https://example.com/guide) and [Citations](/dashboard/citations).',
          'Also [mail](mailto:someone@example.com), [rel](../x) and [proto](//example.org/x).',
          '![a chart](https://example.org/chart.png?d=1)',
        ].join('\n\n'),
      }),
    });
    const links = [...container.querySelectorAll('[data-slot="run-text"] a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/guide',
      '/dashboard/citations',
    ]);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('a chart');
    expect(container.textContent).toContain('mail, rel and proto');
  });

  it('holds what follows while the run works, and says when it reconnects', async () => {
    await render({ run: run({ steps }), footer: <p>Next moves</p>, reconnecting: true });
    expect(container.textContent).not.toContain('Next moves');
    expect(status()).toBe('Reconnecting…');
  });
});
