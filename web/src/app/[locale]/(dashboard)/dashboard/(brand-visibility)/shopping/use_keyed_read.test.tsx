import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadCache, type ReadCache } from '@/components/brand-visibility/read-cache';
import {
  BrandVisibilityShellContext,
  type BrandVisibilityShell,
} from '@/components/brand-visibility/shell-context';
import { useKeyedRead } from './use_keyed_read';

/**
 * Product Visibility's reads: once per key, when wanted, and kept in
 * Visibility's cache, so the tab opened again shows them at once.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let seen: (string | undefined)[];
let cache: ReadCache;

function Probe({
  wanted,
  readKey,
  read,
  attempt,
}: {
  wanted: boolean;
  readKey: string;
  read: () => Promise<string>;
  attempt?: number;
}) {
  seen.push(useKeyedRead(wanted, 'probe', readKey, read, 'the probe', attempt));
  return null;
}

/** A read that answers when told to. */
function deferred() {
  const calls: { resolve: (value: string) => void; reject: (err: Error) => void }[] = [];
  const read = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { read, calls };
}

const render = (props: Parameters<typeof Probe>[0]) =>
  act(() =>
    root.render(
      <BrandVisibilityShellContext.Provider value={{ cache } as BrandVisibilityShell}>
        <Probe {...props} />
      </BrandVisibilityShellContext.Provider>,
    ),
  );
const last = () => seen.at(-1);

beforeEach(() => {
  seen = [];
  cache = createReadCache();
  root = createRoot(document.createElement('div'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

describe('useKeyedRead', () => {
  it('reads nothing until wanted, then once for its key, however often the page renders', async () => {
    const { read, calls } = deferred();
    render({ wanted: false, readKey: 'b1:30d', read });
    expect(read).not.toHaveBeenCalled();
    expect(last()).toBeUndefined();

    render({ wanted: true, readKey: 'b1:30d', read });
    render({ wanted: true, readKey: 'b1:30d', read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(last()).toBeUndefined();
    await act(async () => calls[0].resolve('shelf'));
    expect(last()).toBe('shelf');

    // Not wanted any more (another tab), then wanted again: kept, not read again.
    render({ wanted: false, readKey: 'b1:30d', read });
    render({ wanted: true, readKey: 'b1:30d', read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(last()).toBe('shelf');
  });

  it('reads again for a new key, and drops the answer for the old one', async () => {
    const { read, calls } = deferred();
    render({ wanted: true, readKey: 'b1:30d', read });
    render({ wanted: true, readKey: 'b1:7d', read });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => calls[0].resolve('30 days'));
    expect(last()).toBeUndefined();
    await act(async () => calls[1].resolve('7 days'));
    expect(last()).toBe('7 days');
  });

  it("gives 'failed' for a read that threw", async () => {
    const { read, calls } = deferred();
    render({ wanted: true, readKey: 'b1:30d', read });
    await act(async () => calls[0].reject(new Error('down')));
    expect(last()).toBe('failed');
    expect(console.error).toHaveBeenCalledWith('Failed to read the probe:', expect.any(Error));
  });

  it('shows what the tab read before at once, reads it again quietly, and keeps it if that fails', async () => {
    const { read, calls } = deferred();
    render({ wanted: true, readKey: 'b1:30d', read });
    await act(async () => calls[0].resolve('shelf'));

    // The tab opened again (Visibility's layout kept the cache): on screen at once.
    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    render({ wanted: true, readKey: 'b1:30d', read });
    expect(last()).toBe('shelf');
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => calls[1].resolve('newer shelf'));
    expect(last()).toBe('newer shelf');

    // A quiet read that fails leaves what was there.
    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    render({ wanted: true, readKey: 'b1:30d', read });
    await act(async () => calls[2].reject(new Error('down')));
    expect(last()).toBe('newer shelf');
  });

  it('reads again on a new attempt (Retry)', async () => {
    const { read, calls } = deferred();
    render({ wanted: true, readKey: 'b1:30d', read, attempt: 0 });
    await act(async () => calls[0].reject(new Error('down')));
    expect(last()).toBe('failed');
    render({ wanted: true, readKey: 'b1:30d', read, attempt: 1 });
    expect(last()).toBeUndefined();
    await act(async () => calls[1].resolve('shelf'));
    expect(last()).toBe('shelf');
  });
});
