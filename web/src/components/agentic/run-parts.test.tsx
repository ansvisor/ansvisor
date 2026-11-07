import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatStep, ChatStepPart } from '@/lib/chat/events';
import { RunParts } from './run-parts';
import { RunSteps } from './run-steps';

/**
 * A "Working on N parts" step (CHAT-27 item 7): each part with its status
 * dot and words, its own steps folded until a click opens them, and a line
 * of how many have ended while any works.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const read = (n: number, label: string, status: ChatStep['status'] = 'done'): ChatStep => ({
  n,
  kind: 'read',
  status,
  label,
});

const PARTS: ChatStepPart[] = [
  { title: 'Competitor B', status: 'done', steps: [read(1, 'Read Citations')] },
  { title: 'Competitor C', status: 'running', steps: [read(1, 'Read Mentions', 'running')] },
  { title: 'Competitor D', status: 'failed', steps: [] },
  { title: 'Competitor E', status: 'waiting', steps: [] },
  { title: 'Competitor F', status: 'paused', steps: [] },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(ui: ReactNode) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    ),
  );
}

const parts = () => [...container.querySelectorAll<HTMLLIElement>('[data-slot="run-parts"] li')];
const partRows = () => parts().filter((li) => li.hasAttribute('data-status'));

describe('RunParts', () => {
  it('shows each part with its status dot and words', async () => {
    await render(<RunParts parts={PARTS} />);
    expect(partRows().map((li) => li.dataset.status)).toEqual([
      'done',
      'running',
      'failed',
      'waiting',
      'paused',
    ]);
    const dots = partRows().map(
      (li) => li.querySelector<HTMLElement>('[data-slot="list-dot"]')!.dataset.state,
    );
    expect(dots).toEqual(['done', 'running', 'failed', 'needsYou', 'paused']);
    const words = partRows().map((li) => li.querySelector('button')!.textContent);
    expect(words).toEqual([
      'Competitor BDone',
      'Competitor CWorking',
      'Competitor DFailed',
      'Competitor EWaiting for approval',
      'Competitor FPaused at the AI limit',
    ]);
    // 3 of 5 ended: the line under the step says how far.
    expect(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe(
      '60',
    );
  });

  it("opens a part's own steps on a click, folded until then", async () => {
    await render(<RunParts parts={PARTS} />);
    const [first] = partRows();
    const button = first.querySelector('button')!;
    const steps = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(steps.hidden).toBe(true);
    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(steps.hidden).toBe(false);
    expect(steps.textContent).toContain('Read Citations');
  });

  it('has no progress line once every part ended', async () => {
    await render(
      <RunParts
        parts={PARTS.map((part) => ({
          ...part,
          status: part.status === 'running' ? 'done' : 'failed',
        }))}
      />,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('lists the parts under their step in the run steps', async () => {
    const step: ChatStep = {
      n: 1,
      kind: 'read',
      status: 'running',
      label: 'Working on 5 parts',
      detail: '3 of 5 done',
      rowCount: 5,
      scope: { unit: 'parts' },
      parts: PARTS,
    };
    await render(<RunSteps status="running" steps={[step]} workingMs={4_000} />);
    expect(container.textContent).toContain('Working on 5 parts');
    expect(container.textContent).toContain('3 of 5 done');
    expect(partRows()).toHaveLength(5);
  });
});
