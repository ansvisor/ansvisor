import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { getAiUsage } from '@/lib/actions/ai-usage';
import { aiUsageTone, percentLabel, type AiUsage } from '@/lib/billing/ai-usage';
import { AiUsageCard } from './ai-usage-card';

vi.mock('@/lib/actions/ai-usage', () => ({ getAiUsage: vi.fn() }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'starter',
  planName: 'Starter',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed: 42.5,
  features: [
    { feature: 'improve', percent: 12.5 },
    { feature: 'content', percent: 30 },
    { feature: 'action_center', percent: 0.4 },
  ],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AiUsageCard />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(getAiUsage).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AiUsageCard', () => {
  it('shows the share used, when it resets, and what used it', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(usage());
    await render();
    const text = container.textContent;
    expect(text).toContain("This period's AI usage");
    expect(text).toContain('42% used');
    expect(text).toContain('Resets on November 20, 2026');
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Improve suggestions12%',
      'Content Editor (briefs, Content Agent)30%',
      'Action Center task writing<1%',
    ]);
    expect(text).toContain("Agent Chat runs on your own AI key, so it doesn't use this allowance.");
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuetext')).toBe('42% used');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('42.5%');
    expect(text).not.toContain('used up');
  });

  it('says when the allowance is used up', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(usage({ percentUsed: 100 }));
    await render();
    expect(container.textContent).toContain('100% used');
    expect(container.textContent).toContain(
      "This period's AI usage is used up. AI features resume on November 20, 2026. A bigger plan below comes with more.",
    );
    expect(container.querySelector('[role="progressbar"] > div')!.className).toContain(
      'bg-red-500',
    );
  });

  it('offers no bigger plan on Enterprise', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(usage({ plan: 'enterprise', percentUsed: 100 }));
    await render();
    expect(container.textContent).toContain('AI features resume on November 20, 2026.');
    expect(container.textContent).not.toContain('A bigger plan');
  });

  it('shows nothing without an active plan', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(null);
    await render();
    expect(container.textContent).toBe('');
  });

  it('shows nothing for a plan without an allowance', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(
      usage({ unlimited: true, percentUsed: null, features: [] }),
    );
    await render();
    expect(container.textContent).toBe('');
  });

  it('says it couldn’t read the usage', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAiUsage).mockRejectedValue(new Error('down'));
    await render();
    expect(container.textContent).toContain("Couldn't read this period's AI usage.");
    error.mockRestore();
  });
});

describe('the meter’s reading', () => {
  it('reads a sliver as under 1%, else whole percents, rounded down', () => {
    expect(percentLabel(0)).toBe('0%');
    expect(percentLabel(0.4)).toBe('<1%');
    expect(percentLabel(12.5)).toBe('12%');
    // Never all of it before it is.
    expect(percentLabel(99.9)).toBe('99%');
    expect(percentLabel(100)).toBe('100%');
  });

  it('warns from 80% and is used up at 100%', () => {
    expect(aiUsageTone(usage({ percentUsed: 79.9 }))).toBe('normal');
    expect(aiUsageTone(usage({ percentUsed: 80 }))).toBe('warning');
    expect(aiUsageTone(usage({ percentUsed: 100 }))).toBe('exhausted');
    expect(aiUsageTone(usage({ unlimited: true, percentUsed: null }))).toBe('unlimited');
  });
});
