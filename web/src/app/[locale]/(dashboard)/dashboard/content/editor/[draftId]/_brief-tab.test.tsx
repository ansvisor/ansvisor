import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { DraftBrief } from '@/lib/content/brief';
import { BriefTab, type BriefState } from './_brief-tab';

const saveDraftBrief = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  saveDraftBrief: (...args: unknown[]) => saveDraftBrief(...args),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brief: DraftBrief = {
  goal: 'Help home baristas pick a machine',
  audience: 'First-time espresso buyers',
  outline: [
    {
      heading: 'The best espresso machines under $500',
      keyPoints: ['Price bands', 'What to skip'],
      fanout: 'best espresso machine under 500',
      platform: 'perplexity-web',
    },
    { heading: 'Care and cleaning', keyPoints: [], fanout: null, platform: null },
  ],
  keywords: ['espresso machine', 'grinder'],
  origin: 'rebuild',
  builtAt: '2026-10-21T10:00:00Z',
  builtFrom: { prompts: 2, fanouts: 3, pages: 1, queries: 1 },
};

const onRebuild = vi.fn();
const onRetry = vi.fn();
const onSaved = vi.fn();

let container: HTMLDivElement;
let root: Root;

async function render(
  state: BriefState,
  extra: { pageType?: string | null; sourceUrl?: string | null; length?: number } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BriefTab
          draftId="d1"
          state={state}
          pageType={extra.pageType === undefined ? 'buying_guide' : extra.pageType}
          length={extra.length ?? 3000}
          sourceUrl={
            extra.sourceUrl === undefined ? 'https://acme.example/guides/espresso' : extra.sourceUrl
          }
          rebuilding={false}
          onRebuild={onRebuild}
          onRetry={onRetry}
          onSaved={onSaved}
        />
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  )!;
const fields = () =>
  Object.fromEntries(
    [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]),
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  saveDraftBrief.mockReset();
  onRebuild.mockReset();
  onRetry.mockReset();
  onSaved.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Brief tab', () => {
  it('shows the page, the brief and each H2 with the fan-out it answers', async () => {
    await render({ status: 'ready', brief });
    expect(fields()).toEqual({
      'Page type': 'Buying guide',
      'Target URL': '/guides/espresso',
      Goal: 'Help home baristas pick a machine',
      Audience: 'First-time espresso buyers',
      Length: '3,000 characters · from the rules',
    });
    const sections = [...container.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(sections).toEqual([
      'H2The best espresso machines under $500Price bandsWhat to skipAnswers “best espresso machine under 500”· Perplexity',
      'H2Care and cleaning',
    ]);
    expect(container.textContent).toContain('espresso machinegrinder');
    expect(container.textContent).toContain('Built from 7 sources');

    await act(async () => button('Rebuild outline').click());
    expect(onRebuild).toHaveBeenCalled();
  });

  it('offers to build a brief for a new page without one', async () => {
    await render(
      { status: 'ready', brief: null },
      { pageType: 'product_page', sourceUrl: null, length: 1200 },
    );
    expect(fields()).toMatchObject({
      'Page type': 'Product page',
      'Target URL': 'A new page',
      Goal: '—',
      Length: '1,200 characters · from the rules',
    });
    expect(container.textContent).toContain('No outline yet.');
    expect(button('Edit brief')).toBeUndefined();
    await act(async () => button('Build brief').click());
    expect(onRebuild).toHaveBeenCalled();
  });

  it('says where an opportunity’s brief comes from', async () => {
    await render({
      status: 'ready',
      brief: { ...brief, origin: 'opportunity', builtAt: null, builtFrom: null },
    });
    expect(container.textContent).toContain("From the opportunity's brief.");
  });

  it('edits the brief by hand', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({
      ...next,
      origin: 'edit',
    }));
    await render({ status: 'ready', brief });
    await act(async () => button('Edit brief').click());

    const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const heading = container.querySelector<HTMLInputElement>(
      'input[aria-label="Section 1 heading"]',
    )!;
    const points = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Section 1 key points"]',
    )!;
    await act(async () => {
      setValue(heading, 'Espresso machines under $500');
      setValue(points, 'Price bands\n\n Warranty ');
    });
    await act(async () => button('Remove section 2').click());
    await act(async () => button('Save brief').click());

    expect(saveDraftBrief).toHaveBeenCalledWith('d1', {
      ...brief,
      outline: [
        {
          heading: 'Espresso machines under $500',
          keyPoints: ['Price bands', 'Warranty'],
          fanout: 'best espresso machine under 500',
          platform: 'perplexity-web',
        },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ origin: 'edit' }));
    expect(toast.success).toHaveBeenCalledWith('Brief saved');
  });

  it('keeps the edit open when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    saveDraftBrief.mockRejectedValue(new Error('boom'));
    await render({ status: 'ready', brief });
    await act(async () => button('Edit brief').click());
    await act(async () => button('Save brief').click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the brief. Try again.");
    expect(button('Save brief')).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('offers to retry when the brief can’t be read', async () => {
    await render({ status: 'failed' });
    await act(async () => button('Retry').click());
    expect(onRetry).toHaveBeenCalled();
  });
});
