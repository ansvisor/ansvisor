import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import type { PasteChecks } from '@/lib/content/ready-to-publish';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ saveBlob }));
const draftExportBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/draft-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content/draft-export')>()),
  draftExportBlob,
}));

const { ExportDialog } = await import('./_export-dialog');

/**
 * Export (Quality spec §7b, CE-057): the page ready to paste or save for the
 * destination picked, its placeholders first, its checks, its page fields.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HTML =
  '<h1>Pour-over</h1><p>Use [figure, source] g of coffee. Brew it slowly.</p><p>See <a href="https://ok.example/">the guide</a>.</p>';
const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;
const checks: PasteChecks = {
  links: { count: 1, read: 1, broken: 0 },
  images: { count: 1, withoutAlt: 1 },
  ownCode: 0,
};

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

let container: HTMLDivElement;
let root: Root;
const onFillNow = vi.fn();
const writeText = vi.fn();
const write = vi.fn();

async function render(over: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ExportDialog
          onClose={() => {}}
          title="Pour-over"
          html={HTML}
          isNew
          sourceUrl={null}
          author={ada}
          teamByline="Acme Team"
          checks={checks}
          linksPending={0}
          onFillNow={onFillNow}
          {...over}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  );
const destination = (name: string) =>
  [...dialog().querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (b) => b.textContent === name,
  )!;

/** A Blob's text (jsdom's has no text()). */
const textOf = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

beforeEach(() => {
  localStorage.clear();
  onFillNow.mockReset();
  saveBlob.mockReset();
  toast.success.mockReset();
  draftExportBlob.mockReset().mockResolvedValue(new Blob(['x']));
  writeText.mockReset().mockResolvedValue(undefined);
  write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, write },
    configurable: true,
  });
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ExportDialog', () => {
  it('holds the export while a placeholder is open, and fills it or leaves its sentence out', async () => {
    await render();
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      '1 placeholder is still open. Exports never contain [ ] text.',
    );
    expect(button('Copy for Webflow')!.disabled).toBe(true);
    await act(async () => button('Fill now')!.click());
    expect(onFillNow).toHaveBeenCalled();

    await act(async () => button('Export without them')!.click());
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      'The sentence with the placeholder is left out of this export.',
    );
    await act(async () => button('Copy for Webflow')!.click());
    // As rich text, for the CMS's editor to paste, without the placeholder's sentence.
    const [[[item]]] = write.mock.calls as [[[FakeClipboardItem]]];
    const html = await textOf(item.items['text/html']);
    // The H1 goes in the CMS's title field, the placeholder's sentence nowhere.
    expect(html).toBe(
      '<p>Brew it slowly.</p><p>See <a href="https://ok.example/">the guide</a>.</p>',
    );
    expect(await textOf(item.items['text/plain'])).toContain('Brew it slowly.');
    expect(toast.success).toHaveBeenCalledWith('Copied for Webflow: paste it in.');
    // The fields are read from what goes out: no placeholder in them either.
    expect(dialog().textContent).toContain('Meta descriptionBrew it slowly.Copy');
  });

  it('holds a placeholder in the title or a heading until it is filled', async () => {
    await render({
      html: '<h2>What [name of a real person] uses</h2><p>Use [figure, source] g.</p>',
    });
    await act(async () => button('Export without them')!.click());
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      '1 placeholder is in the title or a heading: fill it first.',
    );
    expect(button('Copy for Webflow')!.disabled).toBe(true);
    // A new dialog: one with the placeholder in its title.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ title: 'Pour-over by [name of a real person]', html: '<p>Done.</p>' });
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      '1 placeholder is still open',
    );
  });

  it("exports a title's and a heading's own brackets as written", async () => {
    const html = '<h1>Best CRM tools [2026 Update]</h1><h2>The checklist [PDF]</h2><p>Done.</p>';
    await render({ title: 'Best CRM tools [2026 Update]', html, initialDestination: 'html' });
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
    expect(button('Copy HTML')!.disabled).toBe(false);
    await act(async () => button('Copy HTML')!.click());
    expect(writeText).toHaveBeenCalledWith(html);
  });

  it('copies as HTML, and says so, where rich text is refused', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    document.execCommand = vi.fn(() => false);
    await render({ html: '<h1>Pour-over</h1><p>Done.</p>' });
    await act(async () => button('Copy for Webflow')!.click());
    expect(writeText).toHaveBeenCalledWith('<p>Done.</p>');
    expect(toast.success).toHaveBeenCalledWith(
      "Copied as HTML: paste it into the editor's HTML or code view.",
    );
  });

  it('lists what it checks: clean HTML, the links, the images', async () => {
    await render({ html: '<p>Done.</p>' });
    const rows = [
      ...dialog().querySelectorAll('[aria-label="Content · ready to paste"] li > div'),
    ].map((row) => row.textContent);
    expect(rows).toEqual([
      'Clean HTML · doneHeadings, lists, tables and FAQ. No editor marks, Page info strip or underlines.',
      '1 link answers · doneEach was read in the last day.',
      '1 of 1 images have no alt text · missingAdd it in the HTML view: a few words on what the image shows.',
    ]);
    await render({
      html: '<p>Done.</p>',
      checks: {
        links: { count: 3, read: 1, broken: 0 },
        images: { count: 0, withoutAlt: 0 },
        ownCode: 2,
      },
      linksPending: 2,
    });
    expect(dialog().textContent).toContain('3 links, still being read');
    expect(dialog().textContent).not.toContain('alt text');
    expect(dialog().textContent).toContain(
      'HTML blocks keep their own code · check it2 elements keep a class, a style or a script',
    );
    // Read for none and nothing coming: no word that they answer.
    await render({
      html: '<p>Done.</p>',
      checks: {
        links: { count: 1, read: 0, broken: 0 },
        images: { count: 0, withoutAlt: 0 },
        ownCode: 0,
      },
    });
    expect(dialog().textContent).toContain("1 of 1 links couldn't be read");
    expect(dialog().textContent).not.toContain('answers');
  });

  it('gives the page fields, each with Copy', async () => {
    await render({ html: '<p>Brew it slowly.</p>' });
    const fieldRows = [...dialog().querySelectorAll('[aria-label="Page fields"] dl > div')].map(
      (row) => row.textContent,
    );
    expect(fieldRows).toEqual([
      'Meta titlePour-overCopy',
      'Meta descriptionBrew it slowly.Copy',
      'Slugpour-overCopy',
      'AuthorAda Lovelace → your CMS author fieldCopy',
      'Featured imageNone in the page',
    ]);
    await act(async () => button('Copy Author')!.click());
    expect(writeText).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('downloads Word and Markdown with the page fields, and remembers the destination', async () => {
    await render({ html: '<p>Done.</p>' });
    // Arrow keys move along the destinations.
    destination('Webflow').focus();
    await act(async () => {
      destination('Webflow').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(destination('HTML').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(destination('HTML'));
    await act(async () => destination('Word').click());
    expect(dialog().textContent).toContain(
      'A Word file, with the page fields in a table on page 1',
    );
    await act(async () => button('Download Word')!.click());
    expect(draftExportBlob).toHaveBeenCalledWith(
      'docx',
      'Pour-over',
      '<p>Done.</p>',
      expect.objectContaining({
        table: expect.objectContaining({
          rows: expect.arrayContaining([['Slug', 'pour-over']]),
        }),
        front: expect.objectContaining({ slug: 'pour-over', author: 'Ada Lovelace' }),
      }),
    );
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'ansvisor_content_pour-over.docx');
    expect(localStorage.getItem('aeo:content-export-destination')).toBe('docx');
    // A new page's front matter dates it today.
    await act(async () => destination('Markdown').click());
    await act(async () => button('Download Markdown')!.click());
    const [, , , fields] = draftExportBlob.mock.calls.at(-1)!;
    expect(fields.front).toHaveProperty('date', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(fields.front).not.toHaveProperty('lastmod');
  });

  it("dates a live page's Markdown as updated today, keeping its published date", async () => {
    await render({
      html: '<p>Done.</p>',
      isNew: false,
      sourceUrl: 'https://acme.com/blog/pour-over/',
      initialDestination: 'md',
    });
    await act(async () => button('Download Markdown')!.click());
    const [format, , , fields] = draftExportBlob.mock.calls.at(-1)!;
    expect(format).toBe('md');
    expect(fields.front).not.toHaveProperty('date');
    expect(fields.front).toHaveProperty('lastmod', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("opens on HTML for Copy HTML, and copies the page's HTML as it is", async () => {
    await render({ html: '<p>Done.</p>', initialDestination: 'html' });
    expect(destination('HTML').getAttribute('aria-checked')).toBe('true');
    await act(async () => button('Copy HTML')!.click());
    expect(writeText).toHaveBeenCalledWith('<p>Done.</p>');
    await act(async () => button('Download HTML')!.click());
    expect(draftExportBlob).toHaveBeenCalledWith(
      'html',
      'Pour-over',
      '<p>Done.</p>',
      expect.anything(),
    );
  });
});
