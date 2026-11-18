import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { PromptVolume } from '@/types';

/**
 * Similar Topics reads the brand's volumes through /api/prompts/read
 * (readPromptVolumes), as Tracked Prompts and Insights do. While the read is
 * pending its cards and list wait in place; a failed read is tried once more
 * and then says so, with Retry, instead of "No similar topics found.", which
 * only a finished read with no topics says. A read that lands after a newer
 * one changes nothing.
 */

const reads = vi.hoisted(() => ({ readPromptVolumes: vi.fn() }));
vi.mock('@/lib/prompts-reads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prompts-reads')>()),
  readPromptVolumes: reads.readPromptVolumes,
}));
const store = vi.hoisted(() => ({ brand: { id: 'b1', name: 'Acme' } as { id: string } | null }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ getActiveBrand: () => store.brand }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: SimilarTopicsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** A promise the test settles when it wants. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const volumeOf = (id: string, keyword: string, googleVolume = 1000): PromptVolume => ({
  id: `v-${id}`,
  promptId: id,
  promptText: `Prompt about ${keyword}?`,
  promptCategory: 'Coffee',
  intent: 'commercial',
  keywords: [keyword],
  googleVolumes: { [keyword]: googleVolume },
  totalGoogleVolume: googleVolume,
  aiVolumeMultiplier: 0.4,
  estAiVolume: googleVolume * 0.4,
  competitionIndex: 42,
  competition: 'MEDIUM',
  fetchedAt: '2026-10-20T00:00:00.000Z',
});

/** The read's answer, as /api/prompts/read gives it. */
const volumesRead = (volumes: PromptVolume[]) => ({ volumes, quota: null, status: null });

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SimilarTopicsPage />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const pending = () => container.querySelector('[data-topics-pending]');
const failed = () => container.querySelector('[data-volumes-failed]');
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const EMPTY = 'No similar topics found.';

beforeEach(() => {
  reads.readPromptVolumes.mockReset();
  store.brand = { id: 'b1' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Similar Topics: a failed volumes read', () => {
  it('shows a skeleton of the cards and list while the read is pending, never the empty state', async () => {
    reads.readPromptVolumes.mockReturnValue(new Promise(() => {}));
    await render();

    expect(reads.readPromptVolumes).toHaveBeenCalledWith('b1');
    expect(pending()).not.toBeNull();
    expect(container.querySelectorAll('tbody [data-topics-pending]').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain(EMPTY);
    expect(failed()).toBeNull();
    // The cards' three figures and the list's count wait too: no zeros before the read.
    expect(container.querySelectorAll('[data-topics-pending]:not(tr)')).toHaveLength(4);
    expect(container.textContent).not.toContain('Clusters0');
  });

  it('tries a failed read once more, and shows the topics when that one comes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.readPromptVolumes
      .mockRejectedValueOnce(new Error('Failed to load volumes'))
      .mockResolvedValueOnce(volumesRead([volumeOf('p1', 'coffee subscription')]));
    await render();

    expect(reads.readPromptVolumes).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('coffee subscription');
    expect(container.textContent).not.toContain(EMPTY);
    expect(failed()).toBeNull();
    expect(pending()).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('says the read failed after two failures, with Retry, which reads again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.readPromptVolumes.mockRejectedValue(new Error('Failed to load volumes'));
    await render();

    expect(reads.readPromptVolumes).toHaveBeenCalledTimes(2);
    expect(failed()).not.toBeNull();
    expect(container.textContent).toContain("Volume data couldn't be loaded.");
    expect(container.textContent).not.toContain(EMPTY);
    // Neither the cards' zeros nor an empty list stand in for the brand's topics.
    expect(container.textContent).not.toContain('unique keywords');
    expect(container.querySelector('table')).toBeNull();

    reads.readPromptVolumes.mockReset();
    reads.readPromptVolumes.mockResolvedValue(volumesRead([volumeOf('p1', 'coffee subscription')]));
    await act(async () => button('Retry')!.click());
    await act(async () => {});

    expect(reads.readPromptVolumes).toHaveBeenCalledOnce();
    expect(reads.readPromptVolumes).toHaveBeenCalledWith('b1');
    expect(failed()).toBeNull();
    expect(container.textContent).toContain('coffee subscription');
  });

  it('shows the skeleton again while Retry reads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.readPromptVolumes.mockRejectedValue(new Error('Failed to load volumes'));
    await render();
    expect(failed()).not.toBeNull();

    reads.readPromptVolumes.mockReset().mockReturnValue(new Promise(() => {}));
    await act(async () => button('Retry')!.click());

    expect(failed()).toBeNull();
    expect(pending()).not.toBeNull();
    expect(container.textContent).not.toContain(EMPTY);
  });

  it('says "No similar topics found." once a finished read brought none', async () => {
    reads.readPromptVolumes.mockResolvedValue(volumesRead([]));
    await render();

    expect(container.textContent).toContain(EMPTY);
    expect(pending()).toBeNull();
    expect(failed()).toBeNull();
    expect(reads.readPromptVolumes).toHaveBeenCalledOnce();
  });

  it('keeps the newer read when an older one lands after it', async () => {
    const older = deferred<ReturnType<typeof volumesRead>>();
    reads.readPromptVolumes
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(volumesRead([volumeOf('p2', 'espresso machines')]));
    await render();
    expect(pending()).not.toBeNull();

    // Another brand: its read is sent, and answers first.
    store.brand = { id: 'b2' };
    await render();
    expect(reads.readPromptVolumes).toHaveBeenLastCalledWith('b2');
    expect(container.textContent).toContain('espresso machines');

    // The first brand's read, answered late, changes nothing.
    await act(async () => older.resolve(volumesRead([volumeOf('p1', 'coffee subscription')])));
    await act(async () => {});
    expect(container.textContent).toContain('espresso machines');
    expect(container.textContent).not.toContain('coffee subscription');
  });

  it('drops an older read that fails after a newer one came', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const older = deferred<ReturnType<typeof volumesRead>>();
    reads.readPromptVolumes
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(volumesRead([volumeOf('p2', 'espresso machines')]));
    await render();

    store.brand = { id: 'b2' };
    await render();
    expect(container.textContent).toContain('espresso machines');

    // Neither retried nor said: the newer read's topics stay.
    await act(async () => older.reject(new Error('Failed to load volumes')));
    await act(async () => {});
    expect(reads.readPromptVolumes).toHaveBeenCalledTimes(2);
    expect(failed()).toBeNull();
    expect(container.textContent).toContain('espresso machines');
    expect(error).not.toHaveBeenCalled();
  });
});
