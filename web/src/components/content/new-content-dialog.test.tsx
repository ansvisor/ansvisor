import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { SiteType } from '@/lib/content/page-types';
import { NewContentDialog } from './new-content-dialog';

const getContentStartOptions = vi.fn();
const createContentDraft = vi.fn();
const getContentOverlap = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentStartOptions: (...args: unknown[]) => getContentStartOptions(...args),
  createContentDraft: (...args: unknown[]) => createContentDraft(...args),
  getContentOverlap: (...args: unknown[]) => getContentOverlap(...args),
}));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom's files can't be read as text, as browsers' can.
if (!('text' in Blob.prototype)) {
  Object.assign(Blob.prototype, {
    text(this: Blob) {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(this);
      });
    },
  });
}

const OPTIONS = {
  opportunities: [
    { id: 'o1', title: 'Northwind vs HubSpot', decision: 'create', pageTitle: null },
    {
      id: 'o2',
      title: 'Create a page for realtors',
      decision: 'create',
      pageTitle: 'CRM for real estate teams',
    },
  ],
  prompts: [{ id: 'p1', text: 'best crm for realtors' }],
  topics: [{ id: 't1', name: 'Real estate', promptCount: 3 }],
};

let container: HTMLDivElement;
let root: Root;

async function render(siteType: SiteType = 'b2b') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NewContentDialog open onOpenChange={vi.fn()} brandId="b1" siteType={siteType} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
const radio = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
    r.textContent?.startsWith(name),
  )!;
const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
const checkedType = () =>
  document.querySelector('[aria-labelledby="start-page-type"] [aria-checked="true"]')?.textContent;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentStartOptions.mockReset().mockResolvedValue(OPTIONS);
  createContentDraft.mockReset().mockResolvedValue('d9');
  getContentOverlap.mockReset().mockResolvedValue({ totalPrompts: 2, pages: [] });
  push.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('New content', () => {
  it('starts a new page from an opportunity, the page type picked from its title', async () => {
    await render();
    expect(getContentStartOptions).toHaveBeenCalledWith('b1');
    expect(button('Continue')!.disabled).toBe(true);

    await click(button('Pick an opportunity'));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Northwind vs HubSpot',
    );
    await click(option);
    await click(button('Continue'));

    expect(document.body.textContent).toContain('Create: Northwind vs HubSpot');
    expect(checkedType()).toBe('Comparison');
    expect(document.body.textContent).toContain('Picked from the title.');

    await click(radio('Guide'));
    expect(checkedType()).toBe('Guide');
    await click(button('Open editor'));
    expect(createContentDraft).toHaveBeenCalledWith('b1', {
      method: 'create',
      title: 'Northwind vs HubSpot',
      pageType: 'guide',
      // Picked, so it stays; Start's guess would follow the page.
      typePicked: true,
      source: { kind: 'opportunity', id: 'o1' },
      bodyHtml: undefined,
    });
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d9');
  });

  it('names the page by the opportunity’s brief title when it has one', async () => {
    await render();
    await click(button('Pick an opportunity'));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Create a page for realtors',
    );
    await click(option);
    await click(button('Continue'));
    expect(document.body.textContent).toContain('Create: CRM for real estate teams');
    expect(checkedType()).toBe('Solution page');
  });

  it('optimizes pasted content, cleaned, and reads its page type from it', async () => {
    await render('ecommerce');
    await click(radio('Optimize content'));
    const box = document.querySelector('textarea')!;
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) =>
          type === 'text/html'
            ? '<h2 style="color:red">Returns policy</h2><p>30 days.</p><script>x()</script>'
            : '',
      },
    });
    await act(async () => box.dispatchEvent(paste));

    expect(document.body.textContent).toContain('Returns policy');
    expect(document.body.textContent).toContain('1 heading · 23 characters');
    await click(button('Continue'));
    expect(document.body.textContent).toContain('Optimize: Returns policy');
    expect(checkedType()).toBe('Policy');
    expect(document.body.textContent).toContain('Picked from the content.');

    await click(button('Open editor'));
    expect(createContentDraft).toHaveBeenCalledWith('b1', {
      method: 'optimize',
      title: 'Returns policy',
      pageType: 'policy',
      typePicked: false,
      source: { kind: 'content' },
      bodyHtml: '<h2>Returns policy</h2><p>30 days.</p>',
    });
    // Content brought to optimize has no prompts to check.
    expect(getContentOverlap).not.toHaveBeenCalled();
  });

  it('takes typed plain text as paragraphs, and a blog post when nothing tells the type', async () => {
    await render();
    await click(radio('Optimize content'));
    const box = document.querySelector('textarea')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(box, 'Our onboarding checklist\n\nStep one.');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Continue'));
    expect(checkedType()).toBe('Blog post');
    expect(document.body.textContent).not.toContain('Picked from');
    await click(button('Open editor'));
    expect(createContentDraft.mock.calls[0][1]).toMatchObject({
      title: 'Our onboarding checklist',
      bodyHtml: '<p>Our onboarding checklist</p><p>Step one.</p>',
    });
  });

  it('reads an uploaded Markdown file, and refuses a spreadsheet', async () => {
    await render();
    await click(radio('Optimize content'));
    await click(
      [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Upload file'),
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const upload = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    };

    await upload(new File(['a,b'], 'keywords.csv'));
    expect(toast.error).toHaveBeenCalledWith(
      "keywords.csv isn't a file this reads: use Word, Markdown, HTML or text.",
    );
    await upload(new File(['# Pipeline forecasting\n\nTeams trust it.'], 'forecast.md'));
    expect(document.body.textContent).toContain('Pipeline forecasting');
    expect(document.body.textContent).toContain('forecast.md · 1 heading');
    expect(button('Continue')!.disabled).toBe(false);
  });

  it('says so when what to start from can’t be read, and tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentStartOptions.mockRejectedValueOnce(new Error('down'));
    await render();
    expect(document.body.textContent).toContain("Couldn't load what to start from.");
    await click(button('Try again'));
    expect(getContentStartOptions).toHaveBeenCalledTimes(2);
    expect(button('Pick an opportunity')).toBeDefined();
  });

  describe('the overlap check', () => {
    const GUIDE = {
      url: 'https://acme.example/guides/espresso-machines-for-beginners/',
      title: 'Espresso machines for beginners',
      promptsInCommon: 3,
      citations: 4,
      gscPosition: 3.5,
    };
    /** Starts a new page from the first opportunity and waits for the check. */
    async function startFromOpportunity() {
      await render();
      await click(button('Pick an opportunity'));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent === 'Northwind vs HubSpot',
      );
      await click(option);
      await click(button('Continue'));
      await act(async () => {});
    }
    const overlapOption = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
        r.textContent?.startsWith(name),
      )!;

    it('says a new page is safe when no page of the brand answers its prompts', async () => {
      await startFromOpportunity();
      expect(getContentOverlap).toHaveBeenCalledWith('b1', { kind: 'opportunity', id: 'o1' });
      expect(document.body.textContent).toContain('No existing page answers these prompts');
      expect(document.body.textContent).toContain('Safe to create');
    });

    it('recommends optimizing a page that already answers most of the prompts', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 4, pages: [GUIDE] });
      await startFromOpportunity();

      expect(document.body.textContent).toContain('An existing page already answers these prompts');
      expect(document.body.textContent).toContain('3 of 4');
      expect(document.body.textContent).toContain('#4');
      const optimize = overlapOption('Optimize /guides/espresso-machines-for-beginners instead');
      expect(optimize.getAttribute('aria-checked')).toBe('true');
      expect(optimize.textContent).toContain('Recommended');
      expect(optimize.textContent).toContain(
        'It already answers 3 of 4 prompts, is cited 4× and ranks #4 on Google',
      );
      // The draft becomes that page's: its title, and the type its address shows.
      expect(document.body.textContent).toContain('Optimize: Espresso machines for beginners');
      expect(checkedType()).toBe('Guide');
      expect(document.body.textContent).toContain("Picked from the page's address.");

      await click(button('Open editor'));
      expect(createContentDraft).toHaveBeenCalledWith('b1', {
        method: 'optimize',
        title: 'Espresso machines for beginners',
        pageType: 'guide',
        // Read from the page's address, so it follows the page.
        typePicked: false,
        source: { kind: 'opportunity', id: 'o1' },
        bodyHtml: undefined,
        sourceUrl: GUIDE.url,
      });
    });

    it('goes back to the new page when creating one anyway', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 4, pages: [GUIDE] });
      await startFromOpportunity();
      await click(overlapOption('Create a new page anyway'));
      expect(document.body.textContent).toContain('Create: Northwind vs HubSpot');
      expect(checkedType()).toBe('Comparison');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'create',
        title: 'Northwind vs HubSpot',
        pageType: 'comparison',
        sourceUrl: undefined,
      });
    });

    it('recommends a new page linked from pages that answer only some prompts', async () => {
      getContentOverlap.mockResolvedValue({
        totalPrompts: 4,
        pages: [
          {
            ...GUIDE,
            url: 'https://acme.example/blog/grinders',
            promptsInCommon: 1,
            gscPosition: null,
          },
        ],
      });
      await startFromOpportunity();
      expect(document.body.textContent).toContain('1 existing page answers some of these prompts');
      expect(document.body.textContent).toContain('—');
      expect(
        overlapOption('Create a new page, link /blog/grinders to it').getAttribute('aria-checked'),
      ).toBe('true');
      expect(overlapOption('Add a section to /blog/grinders')).toBeDefined();
      expect(document.body.textContent).toContain('Create: Northwind vs HubSpot');
    });

    it('lets the page start when the check fails, and tries again', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentOverlap.mockRejectedValueOnce(new Error('down'));
      await startFromOpportunity();
      expect(document.body.textContent).toContain("Couldn't check for overlapping pages.");
      expect(button('Open editor')!.disabled).toBe(false);
      await click(button('Try again'));
      await act(async () => {});
      expect(getContentOverlap).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).toContain('Safe to create');
    });
  });
});
