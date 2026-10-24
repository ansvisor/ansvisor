import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import type { DraftCms } from '@/lib/content/cms-send-client';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const readDraftCms = vi.hoisted(() => vi.fn());
const sendPagesToCms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cms-send-client', () => ({ readDraftCms, sendPagesToCms }));

const { SendDialog } = await import('./send-to-cms-dialog');

/**
 * Send to CMS (#1331): the page to the brand's webhook, its slug and meta
 * filled from the page or what the draft kept, its placeholders first.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HTML = '<h1>Pour-over</h1>\n<p>Brew it slowly.</p>';
const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;
const neverSent: DraftCms = { fields: {}, publishedUrl: null, last: null };

let container: HTMLDivElement;
let root: Root;
const onFillNow = vi.fn();
const onClose = vi.fn();

async function render(over: Partial<Parameters<typeof SendDialog>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SendDialog
          draftId="d1"
          brandId="brand-1"
          title="Pour-over"
          html={HTML}
          sourceUrl={null}
          author={ada}
          teamByline="Acme Team"
          byline={null}
          onFillNow={onFillNow}
          onClose={onClose}
          {...over}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;
const field = (id: string) => dialog().querySelector<HTMLInputElement>(`#${id}`)!;
const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const alert = () => dialog().querySelector('[role="alert"]')?.textContent;

beforeEach(() => {
  onFillNow.mockReset();
  onClose.mockReset();
  toast.success.mockReset();
  readDraftCms.mockReset().mockResolvedValue(neverSent);
  sendPagesToCms.mockReset().mockResolvedValue({
    ok: true,
    deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SendDialog', () => {
  it('fills the fields from the page and sends it without its H1', async () => {
    await render({ byline: 'By Ada Lovelace' });
    expect(readDraftCms).toHaveBeenCalledWith('d1');
    expect(field('cms-slug').value).toBe('pour-over');
    expect(field('cms-meta-title').value).toBe('Pour-over');
    expect(field('cms-meta-description').value).toBe('Brew it slowly.');
    expect(dialog().textContent).toContain('15 characters');

    await act(async () => button('Send').click());
    expect(sendPagesToCms).toHaveBeenCalledWith('brand-1', [
      {
        draftId: 'd1',
        title: 'Pour-over',
        slug: 'pour-over',
        metaTitle: 'Pour-over',
        metaDescription: 'Brew it slowly.',
        // The brand's byline line stays; the CMS's title field carries the H1.
        html: '<p>By Ada Lovelace</p>\n<p>Brew it slowly.</p>',
        author: 'Ada Lovelace',
        featuredImage: null,
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith('Sent to your CMS');
    expect(onClose).toHaveBeenCalled();
  });

  it('starts from what the draft kept and says where the page went live', async () => {
    readDraftCms.mockResolvedValue({
      fields: { slug: 'coffee', metaTitle: 'Coffee, slowly' },
      publishedUrl: 'https://example.com/coffee',
      last: { status: 'published', at: '2026-10-24T10:00:00Z', error: null },
    });
    await render();
    expect(field('cms-slug').value).toBe('coffee');
    expect(field('cms-meta-title').value).toBe('Coffee, slowly');
    expect(field('cms-meta-description').value).toBe('Brew it slowly.');
    const live = dialog().querySelector<HTMLAnchorElement>('a[href="https://example.com/coffee"]');
    expect(live?.closest('p')?.textContent).toBe('Live at https://example.com/coffee');
  });

  it('says how the last send went while the page isn’t live', async () => {
    readDraftCms.mockResolvedValue({
      ...neverSent,
      last: { status: 'failed', at: '2026-10-24T10:00:00Z', error: 'The webhook answered 500' },
    });
    await render();
    expect(dialog().textContent).toContain('The last send failed, Oct 24, 2026, 10:00 AM.');
  });

  it('holds the send while a placeholder is open, and goes to it', async () => {
    await render({ html: '<h1>Pour-over</h1>\n<p>Use [figure] g of coffee.</p>' });
    expect(dialog().textContent).toContain('1 placeholder is still open.');
    expect(button('Send').disabled).toBe(true);
    await act(async () => button('Fill now').click());
    expect(onFillNow).toHaveBeenCalled();
  });

  it('asks for a slug that can go: a slash is fixed, an empty one asked for', async () => {
    await render();
    await setValue(field('cms-slug'), 'blog/coffee');
    expect(field('cms-slug').getAttribute('aria-invalid')).toBe('true');
    expect(dialog().textContent).toContain('Use letters, digits, dots, - and _ only');
    expect(button('Send').disabled).toBe(true);

    await setValue(field('cms-slug'), '');
    expect(field('cms-slug').hasAttribute('aria-invalid')).toBe(false);
    expect(dialog().textContent).toContain("Add a slug: the page's address on your site");
    expect(button('Send').disabled).toBe(true);
  });

  it('holds a page with nothing to publish, or no title', async () => {
    await render({ html: '<h1>Pour-over</h1><p></p>' });
    expect(dialog().textContent).toContain('The page has nothing under its title yet.');
    expect(button('Send').disabled).toBe(true);
    await render({ title: ' ' });
    expect(dialog().textContent).toContain('Give the page a title first');
    expect(button('Send').disabled).toBe(true);
    // Past what the server takes.
    await render({ html: `<h1>Pour-over</h1><p>${'a'.repeat(1_000_000)}</p>` });
    expect(dialog().textContent).toContain('The page is over a million characters');
    expect(button('Send').disabled).toBe(true);
  });

  it('holds the send while the last send can’t be read, and reads it again', async () => {
    // Unread, a page sent before under another slug could land in the CMS twice.
    readDraftCms.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(alert()).toBe(
      "Couldn't read this page's last send. Try again before sending, so it doesn't land in your CMS twice.Try again",
    );
    expect(button('Send').disabled).toBe(true);
    let answer: (read: DraftCms) => void = () => {};
    readDraftCms.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const retry = dialog().querySelector<HTMLButtonElement>('[aria-label="Try again"]')!;
    retry.focus();
    await act(async () => retry.click());
    expect(readDraftCms).toHaveBeenCalledTimes(2);
    // Reading again, it stays where it is (and focus with it), and Send waits.
    expect(retry.isConnected).toBe(true);
    expect(retry.disabled).toBe(true);
    expect(button('Send').disabled).toBe(true);
    await act(async () => answer({ ...neverSent, fields: { slug: 'coffee' } }));
    expect(alert()).toBeUndefined();
    expect(field('cms-slug').value).toBe('coffee');
    expect(button('Send').disabled).toBe(false);
  });

  it('holds the send the same way when the read answers nothing (before 00262)', async () => {
    readDraftCms.mockResolvedValueOnce(null);
    await render();
    expect(alert()).toContain("Couldn't read this page's last send.");
    expect(dialog().querySelector('[aria-label="Try again"]')).not.toBeNull();
    expect(button('Send').disabled).toBe(true);
  });

  it('keeps the person’s changes when the kept fields come in after them', async () => {
    let answer: (read: DraftCms) => void = () => {};
    readDraftCms.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    // Not sent before the kept fields are read.
    expect(button('Send').disabled).toBe(true);
    await setValue(field('cms-slug'), 'my-coffee');
    await act(async () => answer({ ...neverSent, fields: { slug: 'coffee' } }));
    expect(field('cms-slug').value).toBe('my-coffee');
    expect(button('Send').disabled).toBe(false);
  });

  it('still takes the kept slug when the person changed another field first', async () => {
    let answer: (read: DraftCms) => void = () => {};
    readDraftCms.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    await setValue(field('cms-meta-description'), 'My own words.');
    await act(async () =>
      answer({ ...neverSent, fields: { slug: 'coffee', metaDescription: 'Kept words.' } }),
    );
    // The slug it was sent under before, or the CMS could get the page twice.
    expect(field('cms-slug').value).toBe('coffee');
    expect(dialog().querySelector<HTMLTextAreaElement>('#cms-meta-description')!.value).toBe(
      'My own words.',
    );
  });

  it('says why the page didn’t go, and stays open', async () => {
    await render();
    sendPagesToCms.mockResolvedValueOnce({
      ok: false,
      code: 'webhook_not_subscribed',
      field: null,
    });
    await act(async () => button('Send').click());
    expect(alert()).toBe(
      'The brand\'s webhook doesn\'t receive "Content page sent". Turn it on in Webhook Settings on Content Opportunities.',
    );

    sendPagesToCms.mockResolvedValueOnce({ ok: false, code: 'invalid', field: 'pages.0.slug' });
    await act(async () => button('Send').click());
    expect(alert()).toBe('Check the slug and send again.');

    sendPagesToCms.mockResolvedValueOnce({ ok: false, code: 'workspace', field: null });
    await act(async () => button('Send').click());
    expect(alert()).toBe("This brand isn't in your workspace. Switch to one of your brands.");

    // What the webhook answered, in the app's words; else why it wasn't reached.
    const failed = { id: 'x1', draftId: 'd1', status: 'failed' };
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ ...failed, http_status: 500, error: 'The webhook answered 500' }],
    });
    await act(async () => button('Send').click());
    expect(alert()).toBe(
      "The webhook answered 500 and didn't take the page. Check your workflow, then send again.",
    );
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ ...failed, http_status: null, error: 'The webhook could not be reached' }],
    });
    await act(async () => button('Send').click());
    expect(alert()).toBe("The webhook didn't take the page: The webhook could not be reached");

    // The webhook took it (2xx), then the workflow called back failed: its reason.
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ ...failed, http_status: 200, error: 'Slug already taken' }],
    });
    await act(async () => button('Send').click());
    expect(alert()).toBe("The webhook didn't take the page: Slug already taken");

    // Changing a field clears what went wrong.
    await setValue(field('cms-meta-title'), 'Coffee');
    expect(alert()).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
