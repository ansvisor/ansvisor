import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDraftAutosave } from './_use-autosave';

const saveContentDraft = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  saveContentDraft: (...args: unknown[]) => saveContentDraft(...args),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const BODIES = ['<p>a</p>', '<p>ab</p>', '<p>1</p>', '<p>12</p>', '<p>x</p>', '<p>last</p>'];

/** The hook behind buttons, as the editor drives it: one per text, and Retry. */
function Harness() {
  const autosave = useDraftAutosave('d1');
  const [settled, setSettled] = useState('');
  return (
    <div>
      <output>{autosave.state}</output>
      <span data-settled>{settled}</span>
      <button
        data-settle
        onClick={() =>
          void autosave.settle().then(
            () => setSettled('settled'),
            () => setSettled('unsaved'),
          )
        }
      />
      <button data-discard onClick={() => autosave.discard()} />
      {BODIES.map((body) => (
        <button key={body} data-body={body} onClick={() => autosave.schedule(content(body))} />
      ))}
      <button data-retry onClick={() => void autosave.retry()} />
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;
function content(bodyHtml: string) {
  return { title: 'T', bodyHtml };
}
const state = () => container.querySelector('output')!.textContent;
const edit = (body: string) =>
  act(() => container.querySelector<HTMLButtonElement>(`[data-body="${body}"]`)!.click());
const retry = () =>
  act(async () => container.querySelector<HTMLButtonElement>('[data-retry]')!.click());
const press = (name: string) =>
  act(async () => container.querySelector<HTMLButtonElement>(`[data-${name}]`)!.click());
const settled = () => container.querySelector('[data-settled]')!.textContent;

beforeEach(async () => {
  vi.useFakeTimers();
  saveContentDraft.mockReset().mockResolvedValue({ updatedAt: 'now' });
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('the editor’s autosave', () => {
  it('saves once typing pauses, with the latest text', async () => {
    edit('<p>a</p>');
    edit('<p>ab</p>');
    expect(state()).toBe('unsaved');
    expect(saveContentDraft).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveContentDraft).toHaveBeenCalledTimes(1);
    expect(saveContentDraft).toHaveBeenCalledWith('d1', content('<p>ab</p>'));
    expect(state()).toBe('saved');
  });

  it('sends a change made during a save after it, never at the same time', async () => {
    let finish!: () => void;
    saveContentDraft.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ updatedAt: 'now' }))),
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
    expect(saveContentDraft).toHaveBeenLastCalledWith('d1', content('<p>12</p>'));
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
    expect(saveContentDraft).toHaveBeenLastCalledWith('d1', content('<p>x</p>'));
    expect(state()).toBe('saved');
    error.mockRestore();
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
    expect(saveContentDraft).toHaveBeenCalledWith('d1', content('<p>last</p>'));
    root = createRoot(container);
  });

  it('settles: waits for a save under way, then sends what is waiting', async () => {
    let finish!: () => void;
    saveContentDraft.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ updatedAt: 'now' }))),
    );
    edit('<p>1</p>');
    await act(async () => vi.advanceTimersByTime(1500));
    edit('<p>12</p>');

    await press('settle');
    expect(settled()).toBe('');
    await act(async () => finish());
    await act(async () => vi.advanceTimersByTime(200));

    expect(saveContentDraft).toHaveBeenCalledTimes(2);
    expect(saveContentDraft).toHaveBeenLastCalledWith('d1', content('<p>12</p>'));
    expect(settled()).toBe('settled');
    expect(state()).toBe('saved');
  });

  it('does not settle when the save fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveContentDraft.mockRejectedValueOnce(new Error('offline'));
    edit('<p>x</p>');

    await press('settle');
    expect(settled()).toBe('unsaved');
    expect(state()).toBe('failed');
    error.mockRestore();
  });

  it('discards what is waiting once the server has the page', async () => {
    edit('<p>x</p>');
    await press('discard');
    await act(async () => vi.advanceTimersByTime(1500));

    expect(saveContentDraft).not.toHaveBeenCalled();
    expect(state()).toBe('saved');
  });
});
