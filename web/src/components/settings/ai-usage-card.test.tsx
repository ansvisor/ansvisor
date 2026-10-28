import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { getAiUsage } from '@/lib/actions/ai-usage';
import {
  aiUsageFromApi,
  aiUsageTone,
  featurePercentLabel,
  percentLabel,
  type AiUsage,
} from '@/lib/billing/ai-usage';
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
    expect(text).toContain('42.5% used');
    expect(text).toContain('Resets on November 20, 2026');
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Improve suggestions12.5%',
      'Content Editor (briefs, Content Agent, quality checks)30%',
      'Action Center task writing0.4%',
    ]);
    expect(text).toContain("Agent Chat runs on your own AI key, so it doesn't use this allowance.");
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuetext')).toBe('42.5% used');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('42.5%');
    expect(text).not.toContain('used up');
  });

  it('lists only what the server sends, a sliver that rounds to 0 as under a tenth', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(
      usage({
        percentUsed: 12.5,
        features: [
          { feature: 'improve', percent: 12.5 },
          { feature: 'content', percent: 0 },
        ],
      }),
    );
    await render();
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Improve suggestions12.5%',
      'Content Editor (briefs, Content Agent, quality checks)<0.1%',
    ]);
    expect(container.textContent).not.toContain('Action Center task writing');
    expect(container.textContent).not.toContain('No AI usage yet');
  });

  it('says nothing has used it yet, in place of the list', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(usage({ percentUsed: 0, features: [] }));
    await render();
    expect(container.textContent).toContain('0% used');
    expect(container.textContent).toContain('No AI usage yet this period.');
    expect(container.querySelector('ul')).toBeNull();
  });

  it('reads an older API’s answer of every feature at 0 as no usage, not as slivers', async () => {
    const zero = (feature: string) => ({ feature, percent: 0 }) as AiUsage['features'][number];
    vi.mocked(getAiUsage).mockResolvedValue(
      aiUsageFromApi(
        usage({
          percentUsed: 0,
          features: ['improve', 'content', 'action_center', 'quality'].map(zero),
        }),
      ),
    );
    await render();
    expect(container.textContent).toContain('No AI usage yet this period.');
    expect(container.textContent).not.toContain('<0.1%');
    expect(container.querySelector('ul')).toBeNull();
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

  it('says the free trial’s is used up and starting the plan gives more, not a bigger plan', async () => {
    vi.mocked(getAiUsage).mockResolvedValue(usage({ trial: true, percentUsed: 100 }));
    await render();
    expect(container.textContent).toContain(
      "The free trial's AI usage is used up. Starting the plan below gives its full monthly allowance.",
    );
    expect(container.textContent).not.toContain('A bigger plan');
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

  it('scrolls itself into view once read, for the header meter’s See details (#ai-usage)', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.mocked(getAiUsage).mockResolvedValue(usage());

    await render();
    expect(scroll).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '#ai-usage');
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('#ai-usage'));
    window.history.replaceState(null, '', '#');
    // jsdom has no scrollIntoView of its own.
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
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
  it('reads the share as it is now, to a tenth, rounded down', () => {
    expect(percentLabel(0)).toBe('0%');
    // A sliver still reads as used.
    expect(percentLabel(0.04)).toBe('<0.1%');
    expect(percentLabel(0.4)).toBe('0.4%');
    // Each run shows: 1.1, 1.2, … rather than 1% until it's 2%.
    expect(percentLabel(1.1)).toBe('1.1%');
    expect(percentLabel(2.3)).toBe('2.3%');
    expect(percentLabel(4.9)).toBe('4.9%');
    expect(percentLabel(28)).toBe('28%');
    expect(percentLabel(28.3)).toBe('28.3%');
    // Never all of it before it is.
    expect(percentLabel(99.9)).toBe('99.9%');
    expect(percentLabel(99.96)).toBe('99.9%');
    expect(percentLabel(100)).toBe('100%');
  });

  it('reads a listed feature’s 0 as a sliver: the server lists only what used some', () => {
    expect(featurePercentLabel(0)).toBe('<0.1%');
    expect(featurePercentLabel(0.1)).toBe('0.1%');
    expect(featurePercentLabel(12.5)).toBe('12.5%');
    expect(featurePercentLabel(100)).toBe('100%');
  });

  it('warns from 80% and is used up at 100%', () => {
    expect(aiUsageTone(usage({ percentUsed: 79.9 }))).toBe('normal');
    expect(aiUsageTone(usage({ percentUsed: 80 }))).toBe('warning');
    expect(aiUsageTone(usage({ percentUsed: 100 }))).toBe('exhausted');
    expect(aiUsageTone(usage({ unlimited: true, percentUsed: null }))).toBe('unlimited');
  });
});
