import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { CmsSource } from '@/lib/content/cms-send';
import type { ContentDraftListItem } from '@/lib/content/drafts';

const readCmsSources = vi.hoisted(() => vi.fn());
vi.mock('./_cms-sources', () => ({ readCmsSources }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));
const readKeptFields = vi.hoisted(() => vi.fn());
const readDeliveries = vi.hoisted(() => vi.fn());
const sendPagesToCms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cms-send-client', () => ({
  readKeptFields,
  readDeliveries,
  sendPagesToCms,
}));
// One request a page, so a test can refuse the second.
const oneByOne = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/content/cms-send', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content/cms-send')>();
  return {
    ...actual,
    cmsSendGroups: (pages: Parameters<typeof actual.cmsSendGroups>[0]) =>
      oneByOne.on ? pages.map((page) => [page]) : actual.cmsSendGroups(pages),
  };
});

const { BulkSendDialog } = await import('./_bulk-send-dialog');

/**
 * Send to CMS for the Library's selected rows (#1331): the pages that can
 * go, why the others can't, and their sends as the server makes them.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const draft = (id: string, title: string) => ({ id, title }) as ContentDraftListItem;
const source = (id: string, title: string, body: string): CmsSource => ({
  draftId: id,
  title,
  html: `<h1>${title}</h1>\n${body}`,
  sourceUrl: null,
  author: null,
  teamByline: '',
  byline: null,
});
const drafts = [
  draft('d1', 'Pour-over'),
  draft('d2', 'Cold brew'),
  draft('d3', 'Espresso'),
  draft('d4', 'Latte art'),
];

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BulkSendDialog
          brandId="brand-1"
          drafts={drafts}
          brandName="Acme"
          brandLanguage="en"
          onClose={onClose}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;
/** Time going on, a read at a time: each read's answer renders before the next. */
async function tick(ms: number) {
  for (let left = ms; left > 0; left -= 2_000) {
    await act(async () => void (await vi.advanceTimersByTimeAsync(Math.min(2_000, left))));
  }
}
const lines = () => [...dialog().querySelectorAll('li')].map((li) => li.textContent);

beforeEach(() => {
  oneByOne.on = false;
  onClose.mockReset();
  readCmsSources.mockReset().mockResolvedValue(
    new Map([
      ['d1', source('d1', 'Pour-over', '<p>Brew it slowly.</p>')],
      ['d2', source('d2', 'Cold brew', '<p>Steep it [hours] hours.</p>')],
      ['d3', source('d3', 'Espresso', '<p>Pull a shot.</p>')],
      // d4 was deleted meanwhile: left out.
    ]),
  );
  readKeptFields.mockReset().mockResolvedValue(new Map([['d3', { slug: 'espresso-guide' }]]));
  readDeliveries.mockReset();
  toast.mockReset();
  sendPagesToCms.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('BulkSendDialog', () => {
  it('sends the pages that can go, and reads their sends until they have gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
      skipped: 0,
    });
    readDeliveries
      .mockResolvedValueOnce([
        { id: 'x1', draftId: 'd1', status: 'sent', http_status: 200, error: null },
        { id: 'x3', draftId: 'd3', status: 'queued', http_status: null, error: null },
      ])
      .mockResolvedValueOnce([
        { id: 'x1', draftId: 'd1', status: 'sent', http_status: 200, error: null },
        // Deleted while it went: its send reads back with no draft.
        { id: 'x3', draftId: '', status: 'failed', http_status: 500, error: 'No' },
      ]);
    await render();
    expect(readCmsSources).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'brand-1', draftIds: ['d1', 'd2', 'd3', 'd4'] }),
    );
    // The pages read: d4 was deleted meanwhile.
    expect(dialog().textContent).toContain('Send 3 pages to your CMS');
    expect(lines()).toEqual(['Pour-overReady', 'Cold brewPlaceholders to fill', 'EspressoReady']);
    expect(dialog().textContent).toContain("A page that can't go is left out");

    await act(async () => button('Send 2 pages').click());
    const [, pages] = sendPagesToCms.mock.calls[0] as [string, { draftId: string; slug: string }[]];
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(pages.map((page) => [page.draftId, page.slug])).toEqual([
      ['d1', 'pour-over'],
      // What it kept from its last send.
      ['d3', 'espresso-guide'],
    ]);
    expect(dialog().textContent).toContain('Sending: 0 of 2 done.');

    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(readDeliveries).toHaveBeenCalledWith(['x1', 'x3']);
    expect(dialog().textContent).toContain('Sending: 1 of 2 done.');
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('1 page sent, 1 failed.');
    expect(lines()).toEqual([
      'Pour-overSent',
      'Cold brewPlaceholders to fill',
      'EspressoWebhook answered 500',
    ]);
    // Done: no more reads.
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(readDeliveries).toHaveBeenCalledTimes(2);

    await act(async () => button('Close').click());
    expect(onClose).toHaveBeenCalled();
  });

  it('says why nothing went, and keeps the pages to send again', async () => {
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'webhook_not_subscribed', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'The brand\'s webhook doesn\'t receive "Content page sent". Turn it on in Webhook Settings on Content Opportunities.',
    );
    expect(button('Send 2 pages').disabled).toBe(false);
  });

  it('keeps what went when a later request is refused for the day', async () => {
    oneByOne.on = true;
    sendPagesToCms
      .mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
        skipped: 0,
      })
      .mockResolvedValueOnce({ ok: false, code: 'daily_limit', field: null });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(sendPagesToCms).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('1 page sent.');
    expect(lines()).toEqual(['Pour-overSent', 'Cold brewPlaceholders to fill', 'EspressoNot sent']);
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'This workspace has sent 200 pages in the last 24 hours. Try again later.',
    );
  });

  it('posts the next request once the last one’s pages have gone, one page at a time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    oneByOne.on = true;
    sendPagesToCms
      .mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
        skipped: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x3', draftId: 'd3', status: 'sent' }],
        skipped: 0,
      });
    readDeliveries
      .mockResolvedValueOnce([{ id: 'x1', draftId: 'd1', status: 'queued' }])
      // A read that fails is read again.
      .mockResolvedValueOnce(null)
      .mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'sent' }]);
    await render();
    await act(async () => void button('Send 2 pages').click());
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    // What went shows while the next waits, and the dialog can be closed.
    expect(lines()).toEqual([
      'Pour-overSending…',
      'Cold brewPlaceholders to fill',
      'EspressoWaiting',
    ]);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('Sending: 0 of 2 done.');
    expect(button('Close')).toBeDefined();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(readDeliveries).toHaveBeenCalledWith(['x1']);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe('2 pages sent.');
  });

  it('posts no more once the pages before are still going after 30 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 0,
    });
    readDeliveries.mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'queued' }]);
    await render();
    await act(async () => void button('Send 2 pages').click());
    await act(async () => void (await vi.advanceTimersByTimeAsync(30 * 60_000 + 2_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(lines()).toEqual([
      'Pour-overSending…',
      'Cold brewPlaceholders to fill',
      'EspressoNot sent',
    ]);
    expect(dialog().textContent).toContain(
      "The pages before it were still going after 30 minutes, so 1 page wasn't sent.",
    );
  });

  it('posts no more once closed while a request waits, and says how many didn’t go', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 0,
    });
    readDeliveries.mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'queued' }]);
    await render();
    await act(async () => void button('Send 2 pages').click());
    act(() => root.unmount());
    readDeliveries.mockResolvedValue([{ id: 'x1', draftId: 'd1', status: 'sent' }]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "1 page wasn't sent: the dialog closed while the pages before it were still going. Send it again from the Library.",
    );
    root = createRoot(container);
  });

  it('posts no more once closed while a one-page request is out', async () => {
    oneByOne.on = true;
    let answer: (value: unknown) => void = () => {};
    sendPagesToCms.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render();
    await act(async () => void button('Send 2 pages').click());
    act(() => root.unmount());
    // A single page goes at once: it comes back sent, not queued.
    await act(async () =>
      answer({ ok: true, deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }], skipped: 0 }),
    );
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "1 page wasn't sent: the dialog closed while the pages before it were still going. Send it again from the Library.",
    );
    root = createRoot(container);
  });

  it('says Failed, not the 200 the webhook answered, when the workflow then failed', async () => {
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'failed', http_status: 200, error: 'Slug taken' },
      ],
      skipped: 0,
    });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(lines()[0]).toBe('Pour-overFailed');
  });

  it('posts no more requests once the day’s sends are used up', async () => {
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 1,
    });
    await render();
    await act(async () => void button('Send 2 pages').click());
    expect(sendPagesToCms).toHaveBeenCalledTimes(1);
    expect(readDeliveries).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("2 pages weren't sent");
  });

  it('says how many pages the day’s sends left out', async () => {
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
      skipped: 1,
    });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().textContent).toContain(
      "1 page wasn't sent: the workspace has sent 200 pages in the last 24 hours.",
    );
  });

  it('says when the pages couldn’t be read, and reads them again', async () => {
    readCmsSources.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "Couldn't read the pages. Try again.",
    );
    expect(button('Send 0 pages')).toBeUndefined();
    await act(async () => button('Try again').click());
    expect(readCmsSources).toHaveBeenCalledTimes(2);
    expect(button('Send 2 pages').disabled).toBe(false);
  });

  it('names the page a refusal names, and says when one went meanwhile', async () => {
    oneByOne.on = true;
    sendPagesToCms.mockResolvedValueOnce({ ok: false, code: 'invalid', field: 'pages.0.html' });
    await render();
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      "\u201cPour-over\u201d can't go as it is: check its page in the editor.",
    );
    sendPagesToCms.mockResolvedValue({ ok: false, code: 'not_found', field: null });
    await act(async () => button('Send 2 pages').click());
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      'A page was archived or deleted since you picked it.',
    );
  });

  it('leaves the rest to the Library after three minutes, reading on through a failed read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [
        { id: 'x1', draftId: 'd1', status: 'queued' },
        { id: 'x3', draftId: 'd3', status: 'queued' },
      ],
      skipped: 0,
    });
    readDeliveries.mockResolvedValue(null);
    await render();
    await act(async () => button('Send 2 pages').click());
    await tick(60_000);
    expect(dialog().textContent).toContain('Sending: 0 of 2 done.');
    await tick(2 * 60_000 + 4_000);
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe(
      "0 pages sent. The rest are still going: the Library shows each page's send as it lands.",
    );
    const reads = readDeliveries.mock.calls.length;
    await tick(10_000);
    expect(readDeliveries).toHaveBeenCalledTimes(reads);
  });

  it('stops reading once closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sendPagesToCms.mockResolvedValue({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'queued' }],
      skipped: 0,
    });
    await render();
    await act(async () => button('Send 2 pages').click());
    act(() => root.unmount());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(readDeliveries).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
