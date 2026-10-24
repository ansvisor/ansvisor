import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readDraftPage = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  readDraftPage: (...args: unknown[]) => readDraftPage(...args),
}));

const { PAGE_READ_DELAY_MS, PAGE_READ_EVERY_MS, usePageRead } = await import('./_use-page-read');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The page's read for proof (Quality CE-049): asked a few seconds after a
 * save, a minute apart at most, one at a time, not with changes to save;
 * a kept answer is asked about again; a spent budget or the day's reads
 * stop the asks.
 */

let container: HTMLDivElement;
let root: Root;
const PAGE = {
  spots: [],
  proofs: [{ claim: 'waterproof', block: 'Our pack is waterproof.', kind: 'certification' }],
  regulated: null,
};

function Probe({ savedAt, unsaved = false }: { savedAt: string; unsaved?: boolean }) {
  const state = usePageRead('d1', savedAt, true, unsaved);
  return (
    <pre
      data-read={JSON.stringify(state.read)}
      data-reading={String(state.reading)}
      data-paused={String(state.paused)}
      data-limited={String(state.limited)}
    />
  );
}
const attr = (name: string) => container.querySelector('pre')!.getAttribute(name)!;
const render = (savedAt: string, unsaved = false) =>
  act(async () => root.render(<Probe savedAt={savedAt} unsaved={unsaved} />));
const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  readDraftPage
    .mockReset()
    .mockResolvedValue({ ...PAGE, pending: false, limited: false, paused: false });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('usePageRead', () => {
  it('asks a few seconds after a save, not while there are changes to save, a minute apart', async () => {
    await render('s1', true);
    await wait(PAGE_READ_EVERY_MS);
    expect(readDraftPage).not.toHaveBeenCalled();
    await render('s1');
    await wait(PAGE_READ_DELAY_MS);
    expect(readDraftPage).toHaveBeenCalledWith('d1');
    expect(JSON.parse(attr('data-read'))).toEqual(PAGE);
    await render('s2');
    await wait(PAGE_READ_DELAY_MS);
    expect(readDraftPage).toHaveBeenCalledTimes(1);
    await wait(PAGE_READ_EVERY_MS);
    expect(readDraftPage).toHaveBeenCalledTimes(2);
  });

  it('asks again for a kept answer a minute later, without a save', async () => {
    readDraftPage.mockResolvedValueOnce({ ...PAGE, pending: true, limited: false, paused: false });
    await render('s1');
    await wait(PAGE_READ_DELAY_MS);
    expect(attr('data-reading')).toBe('true');
    await wait(PAGE_READ_EVERY_MS);
    expect(readDraftPage).toHaveBeenCalledTimes(2);
    expect(attr('data-reading')).toBe('false');
  });

  it('stops for the session once the budget is spent or the day’s reads are made', async () => {
    readDraftPage.mockResolvedValueOnce({ ...PAGE, pending: false, limited: false, paused: true });
    await render('s1');
    await wait(PAGE_READ_DELAY_MS);
    expect(attr('data-paused')).toBe('true');
    await render('s2');
    await wait(PAGE_READ_EVERY_MS * 2);
    expect(readDraftPage).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    readDraftPage
      .mockReset()
      .mockResolvedValue({ ...PAGE, pending: false, limited: true, paused: false });
    await render('s1');
    await wait(PAGE_READ_DELAY_MS);
    expect(attr('data-limited')).toBe('true');
    await render('s2');
    await wait(PAGE_READ_EVERY_MS * 2);
    expect(readDraftPage).toHaveBeenCalledTimes(1);
  });

  it('stops silently when the API has it off, and waits for a save after a failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    readDraftPage.mockResolvedValueOnce({ error: 'failed' });
    await render('s1');
    await wait(PAGE_READ_DELAY_MS);
    await wait(PAGE_READ_EVERY_MS * 2);
    expect(readDraftPage).toHaveBeenCalledTimes(1);
    readDraftPage.mockResolvedValueOnce({ error: 'off' });
    await render('s2');
    await wait(PAGE_READ_EVERY_MS);
    expect(readDraftPage).toHaveBeenCalledTimes(2);
    await render('s3');
    await wait(PAGE_READ_EVERY_MS * 2);
    expect(readDraftPage).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
