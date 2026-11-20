import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { GettingStartedFacts } from '@/lib/getting-started/steps';

/**
 * The (i) beside the Prompts title: the popover's "How Ansvisor works" steps,
 * its button to the guide, and the guide's ten steps, ticked from the
 * brand's facts, each opening where it's done.
 */

const getGettingStartedFacts = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/getting-started', () => ({ getGettingStartedFacts }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    prefetch,
    ...props
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

const { PromptsInfo } = await import('./_prompts-guide');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const FACTS: GettingStartedFacts = {
  startedAt: null,
  dismissedAt: null,
  confirmedAt: null,
  records: {},
  recordedAt: {},
  kpiSetupAt: null,
  competitors: 0,
  topicPrompts: [],
  gsc: false,
  ga: false,
  firstAnswer: false,
  firstVisit: false,
  dataSuggestions: 0,
  dataTracked: 0,
  contentSuggestions: 0,
  contentPicked: 0,
  contentCreated: 0,
  contentRecent: 0,
  audits: 0,
  draftsCreated: 0,
  draftsOptimized: 0,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getGettingStartedFacts.mockReset();
  getGettingStartedFacts.mockResolvedValue(FACTS);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function render(brandId: string | null = 'b1') {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PromptsInfo brandId={brandId} />
      </NextIntlClientProvider>,
    ),
  );
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {});
}

const infoButton = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="How Ansvisor works with prompts"]');
const guideSteps = () => Array.from(document.querySelectorAll('[data-guide-step]'));
const step = (key: string) => document.querySelector(`[data-guide-step="${key}"]`);

async function openGuide() {
  await click(infoButton());
  await click(document.querySelector('[data-action="prompts.openGuide"]'));
}

describe('PromptsInfo', () => {
  it('opens the popover with what a prompt is and the five steps', async () => {
    await render();
    expect(infoButton()).not.toBeNull();
    expect(document.body.textContent).not.toContain("What's a prompt?");

    await click(infoButton());

    const text = document.body.textContent ?? '';
    expect(text).toContain("What's a prompt?");
    expect(text).toContain('How Ansvisor works');
    expect(text).toContain('Smart AI systems work for you in the background, every day.');
    expect(text).not.toMatch(/agents/i);
    const howSteps = Array.from(document.querySelectorAll('ol > li')).map((li) =>
      li.querySelector('b')?.textContent?.trim(),
    );
    expect(howSteps).toEqual([
      'Finds the best prompts.',
      'You pick what to track.',
      'Asks the AI platforms every day.',
      'Builds your own data.',
      'Smart AI systems show you what to do next.',
    ]);
    expect(document.querySelector('[data-action="prompts.openGuide"]')?.textContent).toContain(
      'Open the step-by-step guide',
    );
    // A prompt is a question or a request, and suggestions come from the AI platforms too.
    expect(document.body.textContent).toContain('Compare the best AEO platforms');
    expect(document.body.textContent).toContain('what the AI platforms themselves answer');
    expect(document.body.textContent).not.toContain('prompt database');
  });

  it('opens the guide with its ten steps, coming-soon ones without a button', async () => {
    await render();
    await openGuide();

    expect(document.body.textContent).not.toContain("What's a prompt?");
    expect(document.querySelector('[data-slot="sheet-title"]')?.textContent).toBe(
      'How to find the best prompts and get positioned in their answers',
    );
    expect(guideSteps()).toHaveLength(10);
    expect(document.querySelector('[data-guide-progress]')?.textContent).toBe('0 of 10 done');
    for (const key of ['mentions', 'ads']) {
      expect(step(key)?.querySelector('a')).toBeNull();
      expect(step(key)?.textContent).toContain('Coming soon');
    }
    expect(step('gsc')?.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/settings/integrations',
    );
    expect(step('suggestions')?.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/prompts/suggestions',
    );
    expect(step('moreTracking')?.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/settings/billing?add=tracking#plan-add-ons',
    );
    expect(document.body.textContent).toContain(
      'Ask Chat to do a step for you: “Connect my Search Console”.',
    );
    expect(getGettingStartedFacts).toHaveBeenCalledWith('b1');
  });

  it("opens a step's page in a new tab and keeps the guide open", async () => {
    await render();
    await openGuide();
    const link = step('audit')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/dashboard/audit');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    link?.addEventListener('click', (e) => e.preventDefault());

    await click(link);

    expect(document.querySelector('[data-slot="sheet-title"]')).not.toBeNull();
  });

  it('closes the guide on a click outside it', async () => {
    await render();
    await openGuide();
    const backdrop = document.querySelector('[data-slot="sheet-overlay"]');
    expect(backdrop).not.toBeNull();

    await click(backdrop as Element);

    expect(document.querySelector('[data-slot="sheet-title"]')).toBeNull();
  });

  it('ticks the steps the brand data shows and counts them', async () => {
    getGettingStartedFacts.mockResolvedValue({
      ...FACTS,
      gsc: true,
      firstVisit: true,
      topicPrompts: [2],
      audits: 1,
    });
    await render();
    await openGuide();

    const done = guideSteps()
      .filter((li) => li.hasAttribute('data-done'))
      .map((li) => li.getAttribute('data-guide-step'));
    expect(done).toEqual(['gsc', 'trafficCode', 'suggestions', 'audit']);
    expect(step('gsc')?.textContent).toContain('Done');
    expect(step('gsc')?.querySelector('a')).toBeNull();
    expect(step('ga')?.querySelector('a')).not.toBeNull();
    expect(document.querySelector('[data-guide-progress]')?.textContent).toBe('4 of 10 done');
  });

  it('ticks nothing when the read fails', async () => {
    getGettingStartedFacts.mockRejectedValue(new Error('down'));
    await render();
    await openGuide();
    expect(guideSteps().filter((li) => li.hasAttribute('data-done'))).toHaveLength(0);
    expect(document.querySelector('[data-guide-progress]')?.textContent).toBe('0 of 10 done');
  });
});
