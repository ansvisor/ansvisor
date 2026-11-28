import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { PriorityReason } from '@/lib/action-center/priority';
import { PastResultTag, shownPastResult } from './past-result-tag';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const reason = (pastSuccess: PriorityReason['pastSuccess']) =>
  ({ pastSuccess }) as unknown as PriorityReason;

function render(r: PriorityReason | null, onRow = vi.fn()) {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <div onClick={onRow}>
          <PastResultTag reason={r} />
        </div>
      </NextIntlClientProvider>,
    ),
  );
  return { container, unmount: () => act(() => root.unmount()) };
}

describe('PastResultTag', () => {
  it('says how earlier actions of its kind did, in full on hover, without opening the row', () => {
    const onRow = vi.fn();
    const { container, unmount } = render(reason({ improved: 4, results: 7, points: 3 }), onRow);
    const tag = container.querySelector('button')!;
    expect(tag.textContent).toBe('4 of 7 worked');
    expect(tag.getAttribute('aria-label')).toBe(
      '4 of 7 worked: 4 of 7 earlier actions of this kind improved results here',
    );
    act(() => tag.click());
    expect(onRow).not.toHaveBeenCalled();
    unmount();
  });

  it('says so when they rarely worked, and names a play', () => {
    const { container, unmount } = render(
      reason({ improved: 1, results: 5, points: -2, play: 'faq' }),
    );
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(
      '1 of 5 worked: Only 1 of 5 earlier actions with this play improved results here',
    );
    unmount();
  });

  it('shows nothing with fewer than two results, or none', () => {
    expect(shownPastResult(reason({ improved: 1, results: 1, points: 1 }))).toBeNull();
    expect(shownPastResult(reason(null))).toBeNull();
    expect(shownPastResult(null)).toBeNull();
    const { container, unmount } = render(reason({ improved: 1, results: 1, points: 1 }));
    expect(container.textContent).toBe('');
    unmount();
  });
});
