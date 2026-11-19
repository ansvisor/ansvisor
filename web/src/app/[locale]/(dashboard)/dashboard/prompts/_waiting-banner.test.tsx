import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { Prompt } from '@/types';

/** The waiting banner's way to more room on Growth: Billing's add-ons card (00546). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);

const { WaitingBanner, movedToWaiting } = await import('./_waiting-banner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const waiting = {
  isActive: false,
  createdAt: '2026-11-10T00:00:00Z',
  waitingSince: '2026-11-10T00:00:00Z',
} as Prompt;
// Tracked from October, then set waiting when the plan's tracking went down.
const moved = (since: string) =>
  ({ isActive: false, createdAt: '2026-10-01T00:00:00Z', waitingSince: since }) as Prompt;
let container: HTMLDivElement;
let root: Root;

async function render(props: {
  used: number;
  addMore?: boolean;
  prompts?: Prompt[];
  maxPrompts?: number;
}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WaitingBanner
          prompts={props.prompts ?? [waiting]}
          quota={{
            maxPrompts: props.maxPrompts ?? 200,
            used: props.used,
            planId: 'growth',
            planName: 'Growth',
          }}
          onShow={() => {}}
          onFreeUp={() => {}}
          addMore={props.addMore}
        />
      </NextIntlClientProvider>,
    );
  });
}
const more = () =>
  [...container.querySelectorAll('a')].find((a) => a.textContent === 'Add more tracking');

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WaitingBanner', () => {
  it('offers more tracking beside freeing up a spot when the plan is full', async () => {
    await render({ used: 200, addMore: true });
    expect(more()?.getAttribute('href')).toBe(
      '/dashboard/settings/billing?add=tracking#plan-add-ons',
    );
    await act(async () => more()!.click());
    expect(analytics.track).toHaveBeenCalledWith('add_on_entry', { source: 'waiting_banner' });
  });

  it('doesn’t while there is room, or where more can’t be bought', async () => {
    await render({ used: 150, addMore: true });
    expect(more()).toBeUndefined();
    await render({ used: 200 });
    expect(more()).toBeUndefined();
  });

  it('says why prompts that were tracked now wait: the plan’s tracking went down', async () => {
    await render({
      used: 200,
      prompts: [waiting, moved('2026-11-18T09:00:00Z'), moved('2026-11-19T09:00:00Z')],
    });
    expect(container.querySelector('[data-moved]')?.textContent).toBe(
      "2 of them were tracked until Nov 19, when your plan's tracking went down to 200 prompt locations.",
    );
    await render({ used: 3, maxPrompts: -1, prompts: [moved('2026-11-19T09:00:00Z')] });
    expect(container.querySelector('[data-moved]')?.textContent).toBe(
      "One of them was tracked until Nov 19, when your plan's tracking went down.",
    );
  });

  it('says nothing more when every waiting prompt was saved waiting', async () => {
    await render({ used: 200 });
    expect(container.querySelector('[data-moved]')).toBeNull();
  });
});

describe('movedToWaiting', () => {
  it('counts the waiting prompts that started waiting over an hour after they were added', () => {
    const justAdded = {
      isActive: false,
      createdAt: '2026-11-19T09:00:00Z',
      waitingSince: '2026-11-19T09:30:00Z',
    } as Prompt;
    const active = { isActive: true, createdAt: '2026-10-01T00:00:00Z' } as Prompt;
    expect(movedToWaiting([waiting, justAdded, active])).toBeNull();
    expect(
      movedToWaiting([moved('2026-11-18T09:00:00Z'), justAdded, moved('2026-11-19T09:00:00Z')]),
    ).toEqual({ count: 2, latest: '2026-11-19T09:00:00Z' });
  });
});
