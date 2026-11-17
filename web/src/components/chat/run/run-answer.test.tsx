import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleContext, type TeamRole } from '@/components/providers/role-provider';
import type { ChatStep } from '@/lib/chat/events';
import { emptyRun, type ClientRun } from '@/lib/chat/run-state';

// The result card's module, where the stamp comes from, links with the app's navigation;
// only the own key's fix link is drawn.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    (rest as { 'data-action'?: string })['data-action'] === 'run.fixKey' ? (
      <a href={href} {...rest}>
        {children}
      </a>
    ) : null,
}));

const { RunAnswer } = await import('./run-answer');

/**
 * An answer as its run works (W1-14, CHAT-03 12a–14): one grey line for the
 * steps done (the fact check among them) that opens their list, the streamed
 * text, Data used and the stamp, the live line at the end while it works,
 * and what follows only once done.
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
    detail: 'Perplexity · Last 30 days',
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
const live = () => container.querySelector<HTMLElement>('[data-slot="run-live"]');
const announced = () => container.querySelector('[data-slot="run-announce"]')!.textContent;
const seconds = () => container.querySelector('[data-slot="run-seconds"]');
const stepsLine = () =>
  container.querySelector<HTMLButtonElement>('[data-action="answer.toggleSteps"]');
/** The steps in the steps line's list, as each says it. */
const listed = () =>
  [...container.querySelectorAll('[data-slot="run-steps-line"] li')].map((li) => li.textContent);
const openList = async () => act(async () => stepsLine()!.click());
/** The answer's parts in order, by their slots. */
const order = () =>
  [...container.querySelectorAll('[data-slot="run-answer"] [data-slot]')]
    .map((el) => el.getAttribute('data-slot')!)
    .filter(
      (slot) =>
        slot.startsWith('run-') && !['run-working', 'run-seconds', 'run-status'].includes(slot),
    );

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
  it('says "Waiting for your OK", never "Working on it", while a run waits on an approval', async () => {
    await render({
      run: run({
        status: 'waiting',
        steps: [
          { n: 1, kind: 'read', label: 'Read Citations', status: 'done' },
          { n: 2, kind: 'write', label: 'Update the page', status: 'waiting' },
        ],
      }),
    });
    expect(container.textContent).toContain('Waiting for your OK');
    expect(container.textContent).not.toContain('Working on it');
  });

  it('says what the running step does, and thinks with none', async () => {
    await render({
      run: run({
        steps: [{ n: 1, kind: 'read', label: 'Read Citations', status: 'running' }],
      }),
    });
    expect(status()).toBe('Reading Citations…');
    // The live line says it: no "Working on it" header above it.
    expect(container.textContent).not.toContain('Working on it');

    await render({ run: run({ status: 'queued' }) });
    expect(status()).toBe('Thinking…');

    await render({ run: run({ steps, text: 'Two pages lost most of it.' }) });
    expect(status()).toBe('Writing the answer…');
  });

  it('keeps the live line at the very end while the run works: under the steps and the streaming text', async () => {
    await render({
      run: run({ steps: [{ ...steps[1], status: 'running' }] }),
    });
    expect(order()).toEqual(['run-live', 'run-announce']);

    await render({
      run: run({ steps, text: 'Two pages lost most of it.' }),
      cards: <p data-slot="run-card">A card</p>,
    });
    expect(order()).toEqual(['run-steps-line', 'run-text', 'run-card', 'run-live', 'run-announce']);
    expect(status()).toBe('Writing the answer…');
    // The steps line says what it read so far: Data used waits for the end.
    expect(container.textContent).not.toContain('Data used');
    // Grey, apart from the answer's words.
    expect(live()!.className).toContain('text-muted-foreground');
    expect(stepsLine()!.className).toContain('text-muted-foreground');
  });

  it('drops the live line once the run is done, failed, stopped or waiting on the person', async () => {
    for (const status of ['done', 'error', 'stopped', 'paused_cap', 'waiting'] as const) {
      await render({ run: run({ status, steps, text: 'Two pages lost most of it.' }) });
      expect(live(), status).toBeNull();
      expect(container.querySelector('[class*="animate-agent-sweep"]'), status).toBeNull();
    }
    // A wait says so on the steps line, still.
    expect(stepsLine()!.textContent).toContain('Waiting for your OK');
  });

  it('moves only without reduced motion: the words shimmer and the dot pulses, both motion-safe', async () => {
    await render({ run: run({ status: 'queued' }) });
    const words = container.querySelector('[data-slot="run-status"]')!;
    expect(words.className).toContain('motion-safe:animate-agent-sweep');
    expect(words.className).toContain('motion-safe:bg-clip-text');
    expect(words.className).toContain('motion-safe:text-transparent');
    const dot = live()!.querySelector('[class*="animate-menu-dot-pulse"]')!;
    expect(dot.className).toContain('motion-safe:animate-menu-dot-pulse');
    // Nothing moves or hides the words outside motion-safe.
    for (const el of live()!.querySelectorAll('*')) {
      for (const cls of el.getAttribute('class')?.split(/\s+/) ?? []) {
        if (/animate-|bg-clip|text-transparent/.test(cls)) expect(cls).toMatch(/^motion-safe:/);
      }
    }
  });

  describe('the seconds on the live line', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const tick = async (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

    it('count the time in the same words from 2 s, and start again when the words change', async () => {
      await render({ run: run({ status: 'queued' }) });
      await tick(1000);
      expect(seconds()).toBeNull();
      await tick(1000);
      expect(live()!.textContent).toBe('Thinking… · 2s');
      await tick(4000);
      expect(live()!.textContent).toBe('Thinking… · 6s');

      // New words: counted afresh.
      await render({
        run: run({ steps: [{ ...steps[1], status: 'running' }] }),
      });
      expect(live()!.textContent).toBe('Reading Citations…');
      await tick(2000);
      expect(live()!.textContent).toBe('Reading Citations… · 2s');
      await tick(70_000);
      expect(live()!.textContent).toBe('Reading Citations… · 1m 12s');
    });

    it('are hidden from screen readers, whose live region says only the words, once each', async () => {
      await render({ run: run({ status: 'queued' }) });
      const region = container.querySelector('[data-slot="run-announce"]')!;
      expect(region.getAttribute('aria-live')).toBe('polite');
      const changes: string[] = [];
      const watch = new MutationObserver(() => changes.push(region.textContent ?? ''));
      watch.observe(region, { childList: true, subtree: true, characterData: true });
      await tick(5000);
      expect(seconds()!.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(seconds()!.getAttribute('aria-hidden')).toBe('true');
      expect(region.contains(seconds())).toBe(false);
      expect(announced()).toBe('Thinking…');
      expect(changes).toEqual([]);

      await render({ run: run({ steps: [{ ...steps[1], status: 'running' }] }) });
      await tick(5000);
      expect(announced()).toBe('Reading Citations…');
      // Then how it ended.
      await render({ run: run({ status: 'done', steps, text: 'Ok.' }) });
      expect(announced()).toBe('Worked for 41s');
      watch.disconnect();
      expect(new Set(changes)).toEqual(new Set(['Reading Citations…', 'Worked for 41s']));
    });
  });

  it('says "Thought for N s" above the answer when the run kept it, and nothing when not', async () => {
    const thought = () => container.querySelector('[data-slot="run-thought"]')?.textContent ?? null;
    const done = {
      status: 'done' as const,
      steps,
      text: 'Two pages lost most of it.',
      generatedAt: '2026-11-03T10:00:00.000Z',
    };
    await render({
      run: run({
        ...done,
        summary: { workingMs: 41_000, stepCount: 3, sources: [], thoughtMs: 12_400 },
      }),
    });
    expect(thought()).toBe('Thought for 12 s');
    const order = [...container.querySelectorAll('[data-slot]')].map((el) =>
      el.getAttribute('data-slot'),
    );
    expect(order.indexOf('run-thought')).toBeLessThan(order.indexOf('run-text'));

    // Turned off in Settings › Chat: the run keeps no thoughtMs, and no line shows.
    await render({
      run: run({ ...done, summary: { workingMs: 41_000, stepCount: 3, sources: [] } }),
    });
    expect(thought()).toBeNull();
    // No words yet: no line either.
    await render({
      run: run({ summary: { workingMs: 400, stepCount: 0, sources: [], thoughtMs: 400 } }),
    });
    expect(thought()).toBeNull();
  });

  it('sums the steps done in one grey line that opens their list, each detail a click away', async () => {
    await render({ run: run({ steps, text: 'Two pages lost most of it.' }) });
    const line = stepsLine()!;
    expect(line.textContent).toBe('Read 1 source and 1 page · checked facts');
    expect(line.getAttribute('aria-expanded')).toBe('false');
    const list = document.getElementById(line.getAttribute('aria-controls')!)!;
    expect(list.hidden).toBe(true);
    // No pills: the steps are said once, in the line's list.
    expect(container.querySelector('button[class*="rounded-full"]')).toBeNull();

    await openList();
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    expect(listed()).toEqual(['Read Citations', 'Opened ansvisor.com/pricing', 'Checked facts']);
    expect(container.textContent).not.toContain('Every figure matches the data');
    // A step with a detail opens it; the one without has nothing to open.
    const open = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-action="answer.openStep"]'),
    ];
    expect(open.map((b) => b.textContent)).toEqual(['Read Citations', 'Checked facts']);
    await act(async () => open[1].click());
    expect(open[1].getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Every figure matches the data');
    // One at a time.
    await act(async () => open[0].click());
    expect(container.textContent).toContain('Perplexity · Last 30 days');
    expect(container.textContent).not.toContain('Every figure matches the data');

    // A button, so Enter and Space work it as a click; a second one folds the list.
    expect(line.tagName).toBe('BUTTON');
    expect(line.type).toBe('button');
    line.focus();
    expect(document.activeElement).toBe(line);
    await openList();
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
  });

  it('says what the steps did from their kinds: reads counted, one step in its words, else steps', async () => {
    const read = (n: number, source: string): ChatStep => ({
      n,
      kind: 'read',
      label: `Read ${source}`,
      status: 'done',
      rowCount: 50,
    });
    await render({
      run: run({
        status: 'done',
        steps: [read(1, 'Citations'), read(2, 'Mentions'), read(3, 'Prompts')],
      }),
    });
    expect(stepsLine()!.textContent).toBe('Read 3 sources');
    // The same source twice: its own words.
    await render({
      run: run({ status: 'done', steps: [read(1, 'Citations'), read(2, 'Citations')] }),
    });
    expect(stepsLine()!.textContent).toBe('Read Citations');
    await render({ run: run({ status: 'done', steps: [read(1, 'Citations'), steps[3]] }) });
    expect(stepsLine()!.textContent).toBe('Read Citations · checked facts');
    // Not all reads: how many steps.
    await render({
      run: run({
        status: 'done',
        steps: [
          read(1, 'Citations'),
          read(2, 'Mentions'),
          { n: 3, kind: 'skill', label: 'Used skill: FAQ writer', status: 'done' },
          { n: 4, kind: 'write', label: 'Saved draft in Content', status: 'done' },
        ],
      }),
    });
    expect(stepsLine()!.textContent).toBe('4 steps');
    // A failed step shows on the line too, its reason in the list.
    await render({
      run: run({
        steps: [
          read(1, 'Citations'),
          { ...read(2, 'Prompts'), status: 'error', detail: 'Took too long this time' },
        ],
      }),
    });
    expect(stepsLine()!.textContent).toBe('Read Citations · 1 step failed');
    await openList();
    expect(listed()).toEqual(['Read Citations', 'Read PromptsTook too long this time']);
    // Thinking alone: no line.
    await render({
      run: run({ status: 'done', steps: [steps[0]], text: 'Hi.' }),
    });
    expect(container.querySelector('[data-slot="run-steps-line"]')).toBeNull();
  });

  it('leaves out a count of 0: fact checks alone say "Checked facts"', async () => {
    const check = (n: number, label: string): ChatStep => ({
      n,
      kind: 'check',
      label,
      status: 'done',
    });
    const checks = [check(1, 'Read your choices in the editor'), check(2, 'Checked facts')];
    // Every step done a check: no sources, no pages.
    await render({ run: run({ status: 'done', steps: checks }) });
    expect(stepsLine()!.textContent).toBe('Checked facts');
    await render({ run: run({ status: 'waiting', steps: checks }) });
    expect(stepsLine()!.textContent).toBe('Waiting for your OK · Checked facts');
    await render({
      run: run({
        steps: [
          ...checks,
          { n: 3, kind: 'read', label: 'Read Prompts', status: 'error', detail: 'Took too long' },
        ],
      }),
    });
    expect(stepsLine()!.textContent).toBe('Checked facts · 1 step failed');
    // Pages but no sources, sources but no pages: only the count that isn't 0.
    const opened = (n: number, page: string): ChatStep => ({
      n,
      kind: 'open_page',
      label: `Opened ${page}`,
      status: 'done',
    });
    await render({
      run: run({
        status: 'done',
        steps: [
          opened(1, 'ansvisor.com/a'),
          opened(2, 'ansvisor.com/b'),
          check(3, 'Checked facts'),
        ],
      }),
    });
    expect(stepsLine()!.textContent).toBe('Opened 2 pages · checked facts');
    const read = (n: number, source: string): ChatStep => ({
      n,
      kind: 'read',
      label: `Read ${source}`,
      status: 'done',
      rowCount: 0,
    });
    await render({
      run: run({
        status: 'done',
        steps: [read(1, 'Citations'), read(2, 'Mentions'), check(3, 'Checked facts')],
      }),
    });
    expect(stepsLine()!.textContent).toBe('Read 2 sources · checked facts');
    await render({
      run: run({ status: 'done', steps: [read(1, 'Citations'), read(2, 'Mentions')] }),
    });
    expect(stepsLine()!.textContent).toBe('Read 2 sources');
  });

  it('shows each step once: no steps header or list beside the line', async () => {
    await render({ run: run({ steps, text: 'Two pages lost most of it.' }) });
    await openList();
    expect(container.querySelector('[data-slot="run-steps"]')).toBeNull();
    expect(container.querySelector('[data-slot="step-list"]')).toBeNull();
    expect(container.querySelectorAll('[data-action="answer.toggleSteps"]')).toHaveLength(1);
    for (const label of ['Read Citations', 'Opened ansvisor.com/pricing', 'Checked facts']) {
      const found = [...container.querySelectorAll('li')].filter((li) => li.textContent === label);
      expect(found, label).toHaveLength(1);
    }
    await render({ run: run({ status: 'done', steps, text: 'Ok.' }) });
    await openList();
    expect(container.querySelectorAll('[data-slot="run-steps-line"] li')).toHaveLength(3);
    expect(container.querySelector('[data-slot="run-steps-line"]')!.textContent).toContain(
      'Worked for 41s',
    );
  });

  it('shows a split step’s parts under the live line while it works', async () => {
    await render({
      run: run({
        steps: [
          {
            n: 1,
            kind: 'skill',
            label: 'Working on 2 parts',
            status: 'running',
            scope: { unit: 'parts' },
            rowCount: 2,
            parts: [
              { title: 'Competitor A', status: 'done', steps: [] },
              { title: 'Competitor B', status: 'running', steps: [] },
            ],
          },
        ],
      }),
    });
    expect(status()).toBe('Working on 2 parts…');
    const working = container.querySelector('[data-slot="run-working"]')!;
    expect(working.querySelector('[data-slot="run-parts"]')!.textContent).toContain('Competitor B');
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
    expect(container.textContent).toContain('Data usedCitationsansvisor.com/pricing');
    expect(container.textContent).toContain(
      'Generated Oct 30, 2026 · 09:14 · Data as of Oct 29, 2026, 23:00',
    );
    expect(announced()).toBe('Worked for 41s');
    expect(container.textContent).toContain('Next moves');
    expect(order()).toEqual(['run-steps-line', 'run-text', 'run-announce']);
  });

  it('never shows how many rows a read read, 0 or 50: in its chip, Data used, its detail or its steps', async () => {
    const reads: ChatStep[] = [
      {
        n: 1,
        kind: 'read',
        label: 'Read Action Center',
        status: 'done',
        detail: 'Last 30 days',
        rowCount: 50,
      },
      {
        n: 2,
        kind: 'read',
        label: 'Read Action History',
        status: 'done',
        detail: 'Last 30 days · ChatGPT',
        rowCount: 0,
      },
    ];
    await render({
      run: run({ status: 'done', steps: reads, text: 'Nothing changed.' }),
    });
    expect(stepsLine()!.textContent).toBe('Read 2 sources');
    expect(container.textContent).toContain('Data usedAction CenterAction History');
    // The list and each step's detail: the period and platforms, never a count.
    await openList();
    expect(listed()).toEqual(['Read Action Center', 'Read Action History']);
    for (const step of container.querySelectorAll<HTMLButtonElement>(
      '[data-action="answer.openStep"]',
    )) {
      await act(async () => step.click());
      expect(container.textContent).toMatch(/Last 30 days/);
    }
    expect(container.textContent).toContain('Last 30 days · ChatGPT');
    expect(container.textContent).not.toMatch(/\brows?\b/);
    expect(container.textContent).not.toMatch(/\b(0|50)\b/);
  });

  it('still counts memory’s saved notes, in its step and under Data used', async () => {
    await render({
      run: run({
        status: 'done',
        steps: [
          {
            n: 1,
            kind: 'read',
            label: 'Used memory',
            status: 'done',
            scope: { subject: 'Memory', unit: 'items' },
            rowCount: 3,
          },
          { n: 2, kind: 'read', label: 'Read Citations', status: 'done', rowCount: 42 },
        ],
        text: 'Ok.',
      }),
    });
    expect(stepsLine()!.textContent).toBe('Read 2 sources');
    await openList();
    expect(listed()).toEqual(['Used memory · 3 items', 'Read Citations']);
    expect(container.textContent).toContain('Data usedMemory · 3 itemsCitations');
    expect(container.textContent).not.toContain('42');
  });

  it('styles the answer as the app’s other AI answers: headings, lists and table cells', async () => {
    await render({
      run: run({ steps, text: '# Why\n\n| Engine | Share |\n|---|---|\n| AIO | 19% |' }),
    });
    const text = container.querySelector('[data-slot="run-text"]')!;
    expect(text.className).toContain('prose');
    expect(text.className).toContain('dark:prose-invert');
    expect(text.querySelector('h1')?.textContent).toBe('Why');
    expect([...text.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['AIO', '19%']);
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

  it('links each AC number to its action, in a new tab, in a paragraph, a list and a table', async () => {
    await render({
      run: run({
        status: 'done',
        text: [
          'Önümüzdeki 30 gün için AC-1497 önce, sonra **AC-62**.',
          '1. AC-1497 – Kaybedilen mention’ları geri kazan\n2. AC-62 – Atıf kaybeden 11 sayfayı yenile',
          '| Action | Due |\n|---|---|\n| AC-429 | Nov 20 |',
        ].join('\n\n'),
      }),
    });
    const text = container.querySelector('[data-slot="run-text"]')!;
    const links = [...text.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['AC-1497', '/dashboard/action-center/actions/code/AC-1497'],
      ['AC-62', '/dashboard/action-center/actions/code/AC-62'],
      ['AC-1497', '/dashboard/action-center/actions/code/AC-1497'],
      ['AC-62', '/dashboard/action-center/actions/code/AC-62'],
      ['AC-429', '/dashboard/action-center/actions/code/AC-429'],
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.getAttribute('data-action')).toBe('answer.openAction');
    }
    expect(links[0].getAttribute('aria-label')).toBe('Open AC-1497 in Action Center, new tab');
    // The words around a number stay as they were.
    expect(text.querySelector('li')!.textContent).toBe(
      'AC-1497 – Kaybedilen mention’ları geri kazan',
    );
    expect(text.querySelector('strong a')?.textContent).toBe('AC-62');
    expect(text.querySelector('td a')?.textContent).toBe('AC-429');
  });

  it('leaves an AC number as text in code, in a link and in a longer word', async () => {
    await render({
      run: run({
        status: 'done',
        text: [
          'Run `AC-1497` as is.',
          '```\nAC-62 stays code\n```',
          'See [the plan for AC-59](/dashboard/citations) and [AC-12](https://example.com/AC-12).',
          'Not AC- alone, XAC-12, AC-12a, AC-1.497 or ac-12.',
        ].join('\n\n'),
      }),
    });
    const text = container.querySelector('[data-slot="run-text"]')!;
    expect(
      [...text.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['the plan for AC-59', '/dashboard/citations'],
      ['AC-12', 'https://example.com/AC-12'],
    ]);
    expect(text.querySelector('a a')).toBeNull();
    expect(text.textContent).toContain('AC-1497');
    expect(text.textContent).toContain('AC-62 stays code');
    expect(text.textContent).toContain('Not AC- alone, XAC-12, AC-12a, AC-1.497 or ac-12.');
  });

  it('opens a link to one action in a new tab, and the Action Center’s pages in this one', async () => {
    await render({
      run: run({
        status: 'done',
        text: [
          '[Win back mentions](/dashboard/action-center/actions/3f6c1d2e-8b7a-4c1d-9e2f-0a1b2c3d4e5f)',
          '[AC-62](/dashboard/action-center/actions?action=a1)',
          '[Actions](/dashboard/action-center/actions) and [Signals](/dashboard/action-center/signals)',
        ].join('\n\n'),
      }),
    });
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[data-slot="run-text"] a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('target')])).toEqual([
      ['Win back mentions', '_blank'],
      ['AC-62', '_blank'],
      ['Actions', null],
      ['Signals', null],
    ]);
    expect(links[0].getAttribute('aria-label')).toBe(
      'Open Win back mentions in Action Center, new tab',
    );
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].getAttribute('aria-label')).toBe('Open AC-62 in Action Center, new tab');
  });

  it('holds what follows while the run works, and says on its live line when it reconnects', async () => {
    await render({ run: run({ steps }), footer: <p>Next moves</p>, reconnecting: true });
    expect(container.textContent).not.toContain('Next moves');
    expect(status()).toBe('Reconnecting…');
    expect(announced()).toBe('Reconnecting…');
    // Said once: the steps line keeps to the steps.
    expect(stepsLine()!.textContent).not.toContain('Reconnecting…');

    await render({ run: run({}), reconnecting: true });
    expect(status()).toBe('Reconnecting…');
    // A run that ended has no live line, reconnecting or not.
    await render({ run: run({ status: 'done', steps }), reconnecting: true });
    expect(live()).toBeNull();
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
    expect(stepsLine()!.textContent).toBe('Stopped: something went wrong · 1 step');
    expect(live()).toBeNull();
    await openList();
    expect(listed()).toEqual(['Read CitationsTimed out']);
  });

  it('says where to fix a failed own key: Open AI Providers for an Admin, ask an Admin otherwise', async () => {
    const reason =
      "Anthropic turned down your workspace's key. So Chat stopped here. What's done so far is kept.";
    const failed = run({ status: 'error', errorReason: reason, keyFailed: true });
    const as = async (role: TeamRole) =>
      act(async () => {
        root.render(
          <RoleContext.Provider value={{ role }}>
            <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
              <RunAnswer workingMs={0} timezone="UTC" run={failed} />
            </NextIntlClientProvider>
          </RoleContext.Provider>,
        );
      });
    const box = () => container.querySelector('[data-slot="run-error"]')!;

    await as('admin');
    expect(box().textContent).toContain(reason);
    const fix = box().querySelector<HTMLAnchorElement>('[data-action="run.fixKey"]')!;
    expect(fix.getAttribute('href')).toBe('/dashboard/settings/ai-providers');
    expect(fix.textContent).toBe('Open AI Providers');

    await as('manager');
    expect(box().querySelector('[data-action="run.fixKey"]')).toBeNull();
    expect(box().textContent).toContain('An Admin can fix it in Settings › AI Providers.');

    // Any other error says neither.
    await render({ run: run({ status: 'error', errorReason: 'Something went wrong.' }) });
    expect(box().textContent).not.toContain('AI Providers');
  });

  it('offers an Admin "Use Ansvisor’s limit" after the own key failed, only where the page does (W4-06)', async () => {
    const onUseAnsvisorLimit = vi.fn();
    const failed = run({ status: 'error', errorReason: 'The key failed.', keyFailed: true });
    const as = async (role: TeamRole, handler?: () => void) =>
      act(async () => {
        root.render(
          <RoleContext.Provider value={{ role }}>
            <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
              <RunAnswer workingMs={0} timezone="UTC" run={failed} onUseAnsvisorLimit={handler} />
            </NextIntlClientProvider>
          </RoleContext.Provider>,
        );
      });
    const use = () =>
      container.querySelector<HTMLButtonElement>('[data-action="run.useAnsvisorLimit"]');

    await as('admin', onUseAnsvisorLimit);
    expect(use()?.textContent).toBe("Use Ansvisor's limit");
    await act(async () => use()!.click());
    expect(onUseAnsvisorLimit).toHaveBeenCalledTimes(1);

    // Not without the page's handler (the limit used up), nor for a Manager.
    await as('admin');
    expect(use()).toBeNull();
    await as('manager', onUseAnsvisorLimit);
    expect(use()).toBeNull();
  });

  it('says "Stopped after 41s · 4 steps" after a Stop, its stopped step skipped, its text kept', async () => {
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
    // Thinking isn't a step it lists.
    expect(stepsLine()!.textContent).toBe('Stopped after 41s · 4 steps');
    await openList();
    const stopped = container.querySelector('[data-state="skipped"]')!;
    expect(stopped.textContent).toBe('Read MentionsStopped');
    expect(live()).toBeNull();
    expect(container.textContent).toContain('So far: two pages.');
    expect(container.querySelector('[data-slot="run-error"]')).toBeNull();
  });
});
