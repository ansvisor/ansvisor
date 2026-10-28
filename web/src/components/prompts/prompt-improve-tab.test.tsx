import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { PlanId } from '@/config/plans';
import type { ImproveQuota, ImproveSet } from '@/lib/prompt-improve';
import { ImproveTab, type ImproveController } from './prompt-improve-tab';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const controller = (
  quota: ImproveQuota | null,
  planId: PlanId | null,
  set: ImproveSet | null = null,
): ImproveController => ({
  status: 'ready',
  set,
  quota,
  planId,
  drafts: [],
  setDrafts: vi.fn(),
  error: null,
  dirty: false,
  count: null,
  generate: vi.fn(),
  reload: vi.fn(),
  send: vi.fn(),
  sending: false,
});

async function render(
  quota: ImproveQuota | null,
  planId: PlanId | null,
  set: ImproveSet | null = null,
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ImproveTab improve={controller(quota, planId, set)} />
      </NextIntlClientProvider>,
    );
  });
}

const generateButton = () =>
  [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Generate suggestions'),
  )!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('the Improve tab’s budget', () => {
  it('says how many generations are left', async () => {
    await render(
      { unlimited: false, exhausted: false, generationsLeft: 3, percentLeft: 60 },
      'starter',
    );
    expect(container.textContent).toContain('About 3 generations left this month');
    expect(container.querySelector('[title="60% of this month\'s budget left"]')).not.toBeNull();
    expect(generateButton().disabled).toBe(false);
    expect(container.querySelector('a[href="/dashboard/settings?tab=billing"]')).toBeNull();
  });

  it('offers Starter the upgrade once its budget is spent', async () => {
    await render(
      { unlimited: false, exhausted: true, generationsLeft: 0, percentLeft: 0 },
      'starter',
    );
    expect(container.textContent).toContain(
      "This month's suggestion budget is used up. It resets when your subscription renews.",
    );
    const upgrade = container.querySelector('a[href="/dashboard/settings?tab=billing"]')!;
    expect(upgrade.textContent).toBe('Upgrade for more');
    expect(generateButton().disabled).toBe(true);
  });

  it('offers a plan in its free trial starting it, once the trial’s budget is spent', async () => {
    await render(
      { unlimited: false, exhausted: true, generationsLeft: 0, percentLeft: 0, trial: true },
      'growth',
    );
    const start = container.querySelector('a[href="/dashboard/settings?tab=billing"]')!;
    expect(start.textContent).toBe('Start your plan');
  });

  it('says when the budget resets on a paid plan, with no upgrade', async () => {
    await render(
      { unlimited: false, exhausted: true, generationsLeft: 0, percentLeft: 0 },
      'growth',
    );
    expect(container.textContent).toContain("This month's suggestion budget is used up.");
    expect(container.querySelector('a[href="/dashboard/settings?tab=billing"]')).toBeNull();
  });

  it('says nothing on an unlimited plan', async () => {
    await render(
      { unlimited: true, exhausted: false, generationsLeft: null, percentLeft: null },
      'self_hosted',
    );
    expect(container.textContent).not.toContain('generations left');
    expect(container.textContent).not.toContain('used up');
  });
});

describe('the Improve tab’s dates', () => {
  it('reads them in English whatever the browser’s locale is', async () => {
    // A Turkish browser: a date without a locale would read "17.10.2026".
    const toLocaleDateString = Date.prototype.toLocaleDateString;
    const toLocaleString = Date.prototype.toLocaleString;
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return toLocaleDateString.call(this, locales ?? 'tr-TR', options);
    });
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return toLocaleString.call(this, locales ?? 'tr-TR', options);
    });
    // The day and time it shows follow the time zone the tests run in.
    const at = '2026-10-17T11:05:00.000Z';
    await render(null, 'self_hosted', {
      sent: {
        latest: { actionId: 'a1', actionNo: 12, sentAt: at, suggestionIds: [] },
        sentSuggestionIds: [],
      },
      rangeKey: '30d',
      region: 'us',
      platforms: [],
      suggestions: [],
      latestResultAt: at,
      generatedAt: at,
      stale: false,
    });
    expect(container.textContent).toMatch(/Generated Oct \d{1,2}, 2026, \d{1,2}:\d{2}\s(AM|PM)/);
    expect(container.textContent).toMatch(/Sent Oct \d{1,2}, 2026 · AC-12/);
  });
});
