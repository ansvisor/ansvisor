import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const publishPage = vi.hoisted(() => vi.fn());
const readPublishAddress = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/publish-client', () => ({ publishPage, readPublishAddress }));

const { PublishDialog } = await import('./publish-dialog');

/** Mark published (CE-013): the address the page is live at, where tracking starts. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onPublished = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PublishDialog draftId="d1" onClose={onClose} onPublished={onPublished} />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const input = () => dialog().querySelector<HTMLInputElement>('#publish-url')!;
const save = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Mark published',
  )!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  onClose.mockReset();
  onPublished.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
  readPublishAddress.mockReset().mockResolvedValue('https://acme.example/blog/cold-brew');
  publishPage.mockReset().mockResolvedValue({
    ok: true,
    publishedUrl: 'https://acme.example/blog/cold-brew',
    publishedAt: '2026-10-25T10:00:00Z',
    onBrandDomain: true,
    taskCompleted: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('PublishDialog', () => {
  it('starts from where the page is live, and marks it published there', async () => {
    await render();
    expect(readPublishAddress).toHaveBeenCalledWith('d1');
    expect(input().value).toBe('https://acme.example/blog/cold-brew');
    await type('  https://acme.example/blog/cold-brew-at-home ');
    await act(async () => save().click());
    expect(publishPage).toHaveBeenCalledWith('d1', 'https://acme.example/blog/cold-brew-at-home');
    expect(toast.success).toHaveBeenCalledWith(
      'Published. The Live page tab measures it from now on.',
    );
    expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ taskCompleted: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says an address off the brand’s domains won’t show numbers', async () => {
    publishPage.mockResolvedValue({
      ok: true,
      publishedUrl: 'https://medium.com/@acme/x',
      publishedAt: '2026-10-25T10:00:00Z',
      onBrandDomain: false,
      taskCompleted: false,
    });
    await render();
    await act(async () => save().click());
    expect(toast.warning).toHaveBeenCalledWith(
      "Published. The address isn't on the brand's domains, so its numbers won't show.",
    );
  });

  it('asks for a full address, and stays open, when it isn’t one', async () => {
    publishPage.mockResolvedValue({ ok: false, code: 'invalid_url' });
    await render();
    await type('acme.example/x');
    await act(async () => save().click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "Give the page's full address, starting with https://.",
    );
    expect(onClose).not.toHaveBeenCalled();
    await type('');
    expect(save().disabled).toBe(true);
  });

  it('waits for the starting address, and starts empty without one', async () => {
    readPublishAddress.mockReturnValue(new Promise(() => {}));
    await render();
    expect(input().disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    readPublishAddress.mockResolvedValue('');
    await render();
    expect(input().value).toBe('');
    expect(save().disabled).toBe(true);
  });
});
