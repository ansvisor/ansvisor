import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatDeliverable } from '@/lib/chat/events';

/**
 * An output card (CHAT-06 items 1–6): what a run made, whether it is in
 * Files, its file's formats, and a page opened in the Content Editor.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);

const { DeliverableCard } = await import('./deliverable-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const RUN = '44444444-4444-4444-8444-444444444444';
const page: ChatDeliverable = {
  title: 'Pricing FAQ',
  type: 'document',
  formats: ['html', 'md', 'docx', 'pdf'],
  status: 'draft',
  href: '/dashboard/content/editor/d1',
  filed: 'in_files',
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(
  async () =>
    new Response('# Pricing FAQ', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="pricing-faq-2026-10-30.md"' },
    }),
);

async function render(deliverable: ChatDeliverable = page) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DeliverableCard runId={RUN} n={2} deliverable={deliverable} />
      </NextIntlClientProvider>,
    );
  });
}
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const action = (name: string) => container.querySelector(`[data-action="${name}"]`);

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  download.saveBlob.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('DeliverableCard', () => {
  it('names what it made, says it is in Files, and opens the page in the Content Editor', async () => {
    await render();
    expect(container.textContent).toContain('Pricing FAQ');
    expect(container.textContent).toContain('Document · In Files · Used in Content draft');
    expect(action('deliverable.openEditor')!.getAttribute('href')).toBe(
      '/dashboard/content/editor/d1',
    );
  });

  it('downloads its file, the run’s n-th, in the formats it offers', async () => {
    await render();
    await click(action('deliverable.download')!);
    expect(
      [...document.querySelectorAll('[data-action="deliverable.downloadAs"]')].map((i) =>
        i.getAttribute('data-format'),
      ),
    ).toEqual(['html', 'md', 'docx', 'pdf']);
    await click(document.querySelector('[data-format="md"]')!);
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/runs/${RUN}/files/2?format=md`);
    expect(download.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'pricing-faq-2026-10-30.md');
    expect(toast).toHaveBeenCalledWith('Downloaded pricing-faq-2026-10-30.md');
  });

  it('says it wasn’t saved when storage is full, with nothing to download', async () => {
    await render({ ...page, href: undefined, filed: 'storage_full' });
    expect(container.textContent).toContain('Document · Not saved to Files · Storage is full');
    expect(action('deliverable.download')).toBeNull();
    expect(action('deliverable.copy')).toBeNull();
    expect(action('deliverable.openEditor')).toBeNull();
  });
});
