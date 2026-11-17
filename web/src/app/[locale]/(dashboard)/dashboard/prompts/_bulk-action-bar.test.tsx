import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { BulkActionBar } from './_bulk-action-bar';

/** The prompts table's bulk action bar: its Locations menu (PROMPT-015), and Track now. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onAddLocations = vi.fn();
const onRemoveLocations = vi.fn();
const onAddTags = vi.fn();
const onRemoveTags = vi.fn();

async function render(
  busy = false,
  track: { count?: number; busy?: boolean; onTrackNow?: () => void } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BulkActionBar
          count={2}
          activeCount={2}
          busy={busy}
          suggesting={false}
          suggestBlockedReason={null}
          deleting={null}
          trackNowCount={track.count}
          trackNowBusy={track.busy}
          onTrackNow={track.onTrackNow}
          onPause={() => {}}
          onResume={() => {}}
          onSuggestContent={() => {}}
          onAddLocations={onAddLocations}
          onRemoveLocations={onRemoveLocations}
          onAddTags={onAddTags}
          onRemoveTags={onRemoveTags}
          onDelete={() => {}}
          onClear={() => {}}
        />
      </NextIntlClientProvider>,
    );
  });
}

const trigger = () =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Locations',
  ) as HTMLButtonElement;

async function openMenu() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger().click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  onAddLocations.mockReset();
  onRemoveLocations.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BulkActionBar', () => {
  it('adds locations to the selection or stops some', async () => {
    await render();
    let items = await openMenu();
    expect(items.map((i) => i.textContent)).toEqual(['Add locations', 'Remove locations']);
    await act(async () => items[1].click());
    expect(onRemoveLocations).toHaveBeenCalledTimes(1);
    expect(onAddLocations).not.toHaveBeenCalled();
    items = await openMenu();
    await act(async () => items[0].click());
    expect(onAddLocations).toHaveBeenCalledTimes(1);
  });

  it('offers Track now for the selected prompts with no answers yet, to those who can track', async () => {
    const onTrackNow = vi.fn();
    const trackNow = () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.startsWith('Track '),
      );
    // Every selected prompt has answers, or the person can't track: no button.
    await render(false, { count: 0, onTrackNow });
    expect(trackNow()).toBeUndefined();
    await render(false, { count: 2 });
    expect(trackNow()).toBeUndefined();

    await render(false, { count: 2, onTrackNow });
    expect(trackNow()?.textContent).toBe('Track now');
    expect(trackNow()?.title).toBe('Start tracking the 2 selected prompts with no answers yet');
    await act(async () => trackNow()!.click());
    expect(onTrackNow).toHaveBeenCalledOnce();

    // Some of the selection: how many it starts.
    await render(false, { count: 1, onTrackNow });
    expect(trackNow()?.textContent).toBe('Track 1 now');
    await render(false, { count: 1, busy: true, onTrackNow });
    expect(trackNow()?.disabled).toBe(true);
  });

  it('waits while another bulk action runs', async () => {
    await render(true);
    expect(trigger().disabled).toBe(true);
  });
});
