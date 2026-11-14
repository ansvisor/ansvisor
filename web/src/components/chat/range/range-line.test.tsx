import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

/**
 * The range chip above the message box (owner request 2026-11-11, a chip
 * since 2026-11-14): "Last 30 days ×", or a dashed "Add date range" before
 * the first pick; the chip keeps a new range at once, a refused one goes back
 * and says so; × clears it; a run that ends reads it again; hidden when it
 * can't be read.
 */

const server = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/lib/actions/chat-range', () => ({
  readChatDateRange: server.read,
  saveChatDateRange: server.save,
}));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const { RangeChip } = await import('./range-line');
const { useChatRangeStore } = await import('./use-chat-range');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  useChatRangeStore.setState({ state: undefined });
  server.read.mockReset().mockResolvedValue({ ok: true, range: '30d' });
  server.save.mockReset().mockResolvedValue({ ok: true });
  toasts.error.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(running = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RangeChip running={running} />
      </NextIntlClientProvider>,
    );
  });
}

const line = () => host.querySelector<HTMLElement>('[data-slot="composer-range"]');
const change = () => host.querySelector<HTMLElement>('[data-action="composer.changeRange"]')!;
const clear = () => host.querySelector<HTMLButtonElement>('[data-action="composer.clearRange"]');
const choices = () => [...document.querySelectorAll<HTMLElement>('[data-action="range.pick"]')];

describe('RangeChip', () => {
  it("shows the person's range as a chip that opens the ranges, with ×", async () => {
    await render();
    expect(line()!.textContent).toBe('Last 30 days×');
    expect(change().getAttribute('aria-label')).toBe("Last 30 days · Chat's date range");
    expect(clear()!.getAttribute('aria-label')).toBe(
      'Clear the date range: Chat asks before the next analysis',
    );
    server.read.mockResolvedValue({ ok: true, range: '2026-10-01/2026-10-15' });
    act(() => useChatRangeStore.setState({ state: undefined }));
    await render();
    expect(line()!.textContent).toBe('Oct 1 – Oct 15×');
  });

  it('offers Add date range, with no ×, before the first pick', async () => {
    server.read.mockResolvedValue({ ok: true, range: null });
    await render();
    expect(line()!.textContent).toBe('Add date range');
    expect(clear()).toBeNull();
    await act(async () => change().click());
    expect(choices()).toHaveLength(4);
  });

  it('clears the range on ×, so Chat asks again', async () => {
    await render();
    await act(async () => clear()!.click());
    expect(server.save).toHaveBeenCalledWith(null);
    expect(line()!.textContent).toBe('Add date range');
  });

  it("shows nothing when it can't be read", async () => {
    server.read.mockResolvedValue({ ok: false });
    await render();
    expect(line()).toBeNull();
  });

  it('keeps a new range at once, and puts the old one back when it is refused', async () => {
    await render();
    await act(async () => change().click());
    expect(choices().map((b) => b.textContent)).toEqual([
      'Last 24 hours',
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
    ]);
    expect(choices()[2].getAttribute('aria-pressed')).toBe('true');
    await act(async () => choices()[1].click());
    expect(server.save).toHaveBeenCalledWith('7d');
    expect(line()!.textContent).toBe('Last 7 days×');
    expect(useChatRangeStore.getState().state).toEqual({ range: '7d', available: true });

    server.save.mockResolvedValue({ ok: false });
    await act(async () => change().click());
    await act(async () => choices()[3].click());
    expect(line()!.textContent).toBe('Last 7 days×');
    expect(toasts.error).toHaveBeenCalledWith("Couldn't save your date range. Try again.");
  });

  it('reads it again when a run in the box ends: its card or a short range may have changed it', async () => {
    await render(true);
    expect(server.read).toHaveBeenCalledTimes(1);
    server.read.mockResolvedValue({ ok: true, range: '7d' });
    await render(false);
    expect(server.read).toHaveBeenCalledTimes(2);
    expect(line()!.textContent).toBe('Last 7 days×');
  });
});
