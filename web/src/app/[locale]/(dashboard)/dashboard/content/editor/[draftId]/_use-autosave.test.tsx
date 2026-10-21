import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDraftAutosave } from './_use-autosave';

const saveContentDraft = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  saveContentDraft: (...args: unknown[]) => saveContentDraft(...args),
}));
// A fingerprint that settles in a microtask, so fake timers drive the saves.
vi.mock('@/lib/content/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content/editor')>()),
  bodyHash: async (html: string) => `hash:${html}`,
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const LOADED = { updatedAt: 't0', bodyHtml: '<p>loaded</p>' };
const BIG = `<p>${'x'.repeat(500_000)}</p>`;
const BODIES = ['<p>a</p>', '<p>ab</p>', '<p>1</p>', '<p>12</p>', '<p>x</p>', '<p>last</p>'];

/** The hook behind buttons, as the editor drives it: one per text, Retry, and settle. */
function Harness() {
  const autosave = useDraftAutosave('d1', LOADED);
  const [settled, setSettled] = useState('');
  return (
    <div>
      <output>{autosave.state}</output>
      <span data-settled>{settled}</span>
      {BODIES.map((body) => (
        <button key={body} data-body={body} onClick={() => autosave.schedule(content(body))} />
      ))}
      <button data-big onClick={() => autosave.schedule(content(BIG))} />
      <button data-retry onClick={() => void autosave.retry()} />
      <button
        data-settle
        onClick={() =>
          void autosave.settle().then(
            () => setSettled('saved'),
            () => setSettled('unsaved'),
          )
        }
      />
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;
function content(bodyHtml: string) {
  return { title: 'T', bodyHtml };
}
const loadedBase = { updatedAt: 't0', bodyHash: 'hash:<p>loaded</p>' };
const saved = (updatedAt = 'now', bodyHash = 'h1') => ({ ok: true, updatedAt, bodyHash });
const state = () => container.querySelector('output')!.textContent;
const settled = () => container.querySelector('[data-settled]')!.textContent;
const edit = (body: string) =>
  act(() => container.querySelector<HTMLButtonElement>(`[data-body="${body}"]`)!.click());
const retry = () =>
  act(async () => container.querySelector<HTMLButtonElement>('[data-retry]')!.click());
const settle = () =>
  act(async () => container.querySelector<HTMLButtonElement>('[data-settle]')!.click());

beforeEach(async () => {
  vi.useFakeTimers();
  saveContentDraft.mockReset().mockResolvedValue(saved());
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('the editor’s autosave', () => {
  it('saves once typing pauses, with the latest text, over the version it loaded', async () => {
    edit('<p>a</p>');
    edit('<p>ab</p>');
    expect(state()).toBe('unsaved');
    expect(saveContentDraft).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveContentDraft).toHaveBeenCalledTimes(1);
    expect(saveContentDraft).toHaveBeenCalledWith('d1', {
      ...content('<p>ab</p>'),
      base: loadedBase,
    });
    expect(state()).toBe('saved');
  });

  it('sends a change made during a save after it, over the version that save made', async () => {
    let finish!: () => void;
    saveContentDraft.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(saved('t1', 'h1')))),
    );
    edit('<p>1</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(state()).toBe('saving');

    edit('<p>12</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveContentDraft).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(state()).toBe('unsaved');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveContentDraft).toHaveBeenCalledTimes(2);
    expect(saveContentDraft).toHaveBeenLastCalledWith('d1', {
      ...content('<p>12</p>'),
      base: { updatedAt: 't1', bodyHash: 'h1' },
    });
    expect(state()).toBe('saved');
  });

  it('keeps the text after a failed save, and Retry sends it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveContentDraft.mockRejectedValueOnce(new Error('offline'));
    edit('<p>x</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(state()).toBe('failed');

    await retry();
    expect(saveContentDraft).toHaveBeenCalledTimes(2);
    expect(saveContentDraft).toHaveBeenLastCalledWith('d1', {
      ...content('<p>x</p>'),
      base: loadedBase,
    });
    expect(state()).toBe('saved');
    error.mockRestore();
  });

  it('stops saving when the page was changed elsewhere, rather than overwriting it', async () => {
    saveContentDraft.mockResolvedValueOnce({ ok: false, reason: 'conflict' });
    edit('<p>x</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(state()).toBe('conflict');

    edit('<p>last</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    await retry();
    expect(saveContentDraft).toHaveBeenCalledTimes(1);
    expect(state()).toBe('conflict');
  });

  it('doesn’t send a page over the size limit, and saves again once it is shorter', async () => {
    act(() => container.querySelector<HTMLButtonElement>('[data-big]')!.click());
    expect(state()).toBe('too_large');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveContentDraft).not.toHaveBeenCalled();

    edit('<p>x</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveContentDraft).toHaveBeenCalledTimes(1);
    expect(state()).toBe('saved');
  });

  it('settles: saves what is waiting first, and says when the page can’t be saved', async () => {
    edit('<p>x</p>');
    await settle();
    expect(saveContentDraft).toHaveBeenCalledTimes(1);
    expect(settled()).toBe('saved');

    saveContentDraft.mockResolvedValueOnce({ ok: false, reason: 'conflict' });
    edit('<p>last</p>');
    await settle();
    expect(settled()).toBe('unsaved');
  });

  it('asks before leaving the page while something is unsaved', async () => {
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    edit('<p>x</p>');
    expect(leave()).toBe(true);
    await act(async () => vi.advanceTimersByTime(1500));
    expect(leave()).toBe(false);
  });

  it('saves what is waiting when the editor closes', async () => {
    edit('<p>last</p>');
    act(() => root.unmount());
    await act(async () => {});
    expect(saveContentDraft).toHaveBeenCalledWith('d1', {
      ...content('<p>last</p>'),
      base: loadedBase,
    });
    root = createRoot(container);
  });
});
