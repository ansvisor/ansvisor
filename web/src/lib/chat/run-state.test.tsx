import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { RunSteps } from '@/components/agentic/run-steps';
import { chatEvent, type ChatEvent, type ChatStep } from './events';
import { applyChatEvent, emptyRun, runFromEvents } from './run-state';

/** A run as the browser builds it from its events (CHAT-00, CHAT-03 items 19 and 21). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const read: ChatStep = { n: 1, kind: 'read', status: 'running', label: 'Read Citations' };
const summary = { workingMs: 41_000, stepCount: 2, sources: [] };

const events: ChatEvent[] = [
  chatEvent('step.started', 1, { step: read }),
  chatEvent('step.finished', 2, { step: { ...read, status: 'done', rowCount: 42 } }),
  chatEvent('text.delta', 3, { text: 'Citations fell ' }),
  chatEvent('step.started', 4, {
    step: { n: 2, kind: 'write', status: 'waiting', label: 'Save drafts in Content' },
  }),
  chatEvent('confirm.required', 5, {
    n: 2,
    action: 'Save drafts in Content',
    target: 'Pricing FAQ',
    digest: 'a'.repeat(32),
    canDontAskAgain: false,
  }),
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

describe('the run in the browser', () => {
  it('waits on its card, and goes on once the step runs again', () => {
    const waiting = runFromEvents(events);
    expect(waiting).toMatchObject({ status: 'waiting', text: 'Citations fell ', lastSeq: 5 });
    expect(waiting.confirm?.n).toBe(2);
    const approved = applyChatEvent(
      waiting,
      chatEvent('step.updated', 6, {
        step: { n: 2, kind: 'write', status: 'running', label: 'Save drafts in Content' },
      }),
    );
    expect(approved).toMatchObject({ status: 'running', confirm: null });
  });

  it('skips an event it already has, or a type it doesn’t know', () => {
    const run = runFromEvents(events);
    expect(applyChatEvent(run, events[2])).toBe(run);
    expect(
      applyChatEvent(run, { type: 'future.thing', seq: 9, data: {} } as unknown as ChatEvent),
    ).toBe(run);
  });

  it('says "Stopped after …" once stopped', async () => {
    const stopped = runFromEvents([
      ...events,
      chatEvent('step.finished', 6, {
        step: {
          n: 2,
          kind: 'write',
          status: 'skipped',
          label: 'Save drafts in Content',
          detail: 'Stopped',
        },
      }),
      chatEvent('run.stopped', 7, { ...summary, reason: 'person' }),
    ]);
    expect(stopped).toMatchObject({ status: 'stopped', confirm: null, text: 'Citations fell ' });
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <RunSteps status="stopped" steps={stopped.steps} workingMs={stopped.summary!.workingMs} />
        </NextIntlClientProvider>,
      ),
    );
    expect(container.textContent).toContain('Stopped after 41s');
  });

  it('keeps the end’s timestamps and an error’s words', () => {
    const done = applyChatEvent(
      emptyRun(),
      chatEvent('run.finished', 1, {
        ...summary,
        generatedAt: '2026-10-29T09:14:00.000Z',
        dataAsOf: '2026-10-29T06:00:00.000Z',
      }),
    );
    expect(done).toMatchObject({
      status: 'done',
      generatedAt: '2026-10-29T09:14:00.000Z',
      dataAsOf: '2026-10-29T06:00:00.000Z',
    });
    const failed = applyChatEvent(
      emptyRun(),
      chatEvent('run.error', 1, { ...summary, code: 'failed', reason: 'Chat stopped here.' }),
    );
    expect(failed).toMatchObject({ status: 'error', errorReason: 'Chat stopped here.' });
  });
});
