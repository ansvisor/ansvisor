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

const { WaitingBanner } = await import('./_waiting-banner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const waiting = { isActive: false, waitingSince: '2026-11-10T00:00:00Z' } as Prompt;
let container: HTMLDivElement;
let root: Root;

async function render(props: { used: number; addMore?: boolean }) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WaitingBanner
          prompts={[waiting]}
          quota={{ maxPrompts: 200, used: props.used, planId: 'growth', planName: 'Growth' }}
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
});
