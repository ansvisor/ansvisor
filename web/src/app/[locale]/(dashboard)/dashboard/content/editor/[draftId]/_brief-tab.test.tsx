import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { DraftBrief } from '@/lib/content/brief';
import type { DraftMethod } from '@/lib/content/drafts';
import { BriefTab, type AgentRewrite, type BriefState } from './_brief-tab';

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
  extra: {
    pageType?: string | null;
    sourceUrl?: string | null;
    length?: number;
    method?: DraftMethod;
    rewrite?: AgentRewrite;
  } = {},
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
          method={extra.method ?? 'optimize'}
          rebuilding={false}
          onRebuild={onRebuild}
          onRetry={onRetry}
          onSaved={onSaved}
          rewrite={extra.rewrite}
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
    // The card first: the brief is there, so Rebuild brief, the secondary button.
    expect(container.textContent).toContain('Brief ready · 2 H2s');
    expect(button('Rebuild brief').className).not.toContain('bg-primary');
    expect(button('What Run Agent does')).toBeDefined();
    expect(fields()).toEqual({
      'Page type': 'Buying guide',
      'Target URL': '/guides/espresso',
      Goal: 'Help home baristas pick a machine',
      Audience: 'First-time espresso buyers',
      // Characters first, as rules count; about as many words next to them.
      Length: '3,000 characters · ~500 wordsFrom the rules',
    });
    const sections = [...container.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(sections).toEqual([
      'H2The best espresso machines under $500Price bandsWhat to skipAnswers “best espresso machine under 500”· Perplexity',
      'H2Care and cleaning',
    ]);
    expect(container.textContent).toContain('espresso machinegrinder');
    expect(container.textContent).toContain('Built from 7 sources');

    await act(async () => button('Rebuild brief').click());
    expect(onRebuild).toHaveBeenCalled();
  });

  it('asks before rebuilding a brief the person edited', async () => {
    await render({ status: 'ready', brief: { ...brief, origin: 'edit' } });
    await act(async () => button('Rebuild brief').click());
    expect(onRebuild).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'Rebuild brief writes a new brief over the one you edited.',
    );
    await act(async () => button('Keep my brief').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onRebuild).not.toHaveBeenCalled();

    await act(async () => button('Rebuild brief').click());
    await act(async () => button('Rebuild anyway').click());
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it('says next to Length how long the cited pages are, once read (CE-030)', async () => {
    await render({
      status: 'ready',
      brief: { ...brief, citedLength: { characters: 4300, pages: 3 } },
    });
    expect(fields().Length).toBe(
      '3,000 characters · ~500 wordsFrom the rules · a typical cited page has 4,300 characters (median of 3)',
    );
  });

  it('offers Run Agent for a new page without a brief, or H2s added by hand', async () => {
    await render(
      { status: 'ready', brief: null },
      { pageType: 'product_page', sourceUrl: null, length: 1200 },
    );
    expect(container.textContent).toContain('No brief yetGoal, audience and outline are empty.');
    expect(fields()).toMatchObject({
      'Page type': 'Product page',
      'Target URL': 'A new page',
      Goal: 'Not set yet',
      Audience: 'Not set yet',
      Length: '1,200 characters · ~200 wordsFrom the rules',
    });
    expect(container.textContent).toContain('Empty. Run Agent to draft one, or add H2s yourself.');
    // Run Agent is the black primary while there's nothing to rebuild.
    expect(button('Run Agent').className).toContain('bg-primary');
    await act(async () => button('Run Agent').click());
    expect(onRebuild).toHaveBeenCalled();

    // Or the person writes the H2s.
    await act(async () => button('Edit brief').click());
    expect(container.querySelectorAll('input[aria-label$="heading"]')).toHaveLength(0);
    expect(button('Add section')).toBeDefined();
  });

  it('asks right under the card, before rebuilding an edited brief', async () => {
    await render({ status: 'ready', brief: { ...brief, origin: 'edit' } });
    await act(async () => button('Rebuild brief').click());
    // The question sits with the button that asked, before the page type and outline.
    const alert = container.querySelector('[role="alert"]')!;
    expect(
      alert.compareDocumentPosition(container.querySelector('dl')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says a brief with a goal but no H2s yet can be rebuilt', async () => {
    await render({ status: 'ready', brief: { ...brief, outline: [] } });
    expect(container.textContent).toContain('Brief ready · no H2s yet');
    expect(container.textContent).toContain(
      'No H2s yet. Rebuild brief to draft them, or add H2s yourself.',
    );
  });

  it('saves H2s added by hand on a draft without a brief', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({ ...next }));
    await render({ status: 'ready', brief: null });
    await act(async () => button('Edit brief').click());
    await act(async () => button('Add section').click());
    const heading = container.querySelector<HTMLInputElement>('input[aria-label$="heading"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        heading,
        'What pipeline forecasting is',
      );
      heading.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Save brief').click());
    expect(saveDraftBrief).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        goal: '',
        audience: '',
        outline: [expect.objectContaining({ heading: 'What pipeline forecasting is' })],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('runs the agent without asking over an edited brief that is still empty', async () => {
    await render({
      status: 'ready',
      brief: { ...brief, goal: '', audience: '', outline: [], origin: 'edit' },
    });
    await act(async () => button('Run Agent').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onRebuild).toHaveBeenCalledTimes(1);
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

  it('rewrites a new page from the brief, once the person says so', async () => {
    const run = vi.fn();
    await render(
      { status: 'ready', brief },
      { method: 'create', sourceUrl: null, rewrite: { run, running: false, blocked: null } },
    );
    await act(async () => button('Rewrite from brief').click());
    expect(run).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'The page you have now stays in History.',
    );
    await act(async () => button('Start the agent').click());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('suggests changes to a live page from the brief, and waits for open suggestions', async () => {
    const run = vi.fn();
    await render(
      { status: 'ready', brief },
      { rewrite: { run, running: false, blocked: 'Accept or reject the open suggestions first.' } },
    );
    const suggest = button('Suggest changes from brief');
    expect(suggest.disabled).toBe(true);
    // Why, written under the button: not only on hover (v1.1 CE-031).
    expect(suggest.parentElement!.textContent).toContain(
      'Accept or reject the open suggestions first.',
    );

    await render({ status: 'ready', brief }, { rewrite: { run, running: false, blocked: null } });
    await act(async () => button('Suggest changes from brief').click());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'Passages AI answers quote stay as they are.',
    );
    await act(async () => button('Cancel').click());
    expect(run).not.toHaveBeenCalled();
  });

  it('offers no rewrite without an outline, or once the page is ready', async () => {
    const run = vi.fn();
    await render(
      { status: 'ready', brief: { ...brief, outline: [] } },
      { rewrite: { run, running: false, blocked: null } },
    );
    expect(button('Suggest changes from brief')).toBeUndefined();
    await render({ status: 'ready', brief });
    expect(button('Suggest changes from brief')).toBeUndefined();
  });

  it('offers to retry when the brief can’t be read', async () => {
    await render({ status: 'failed' });
    await act(async () => button('Retry').click());
    expect(onRetry).toHaveBeenCalled();
  });
});
