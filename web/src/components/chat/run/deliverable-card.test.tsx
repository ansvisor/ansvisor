import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatDeliverable, ChatTaskStrip } from '@/lib/chat/events';

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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const getMore = vi.hoisted(() => ({ open: null as ((tab?: string) => void) | null }));
vi.mock('@/components/ai-usage/get-more-context', () => ({ useGetMore: () => getMore.open }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
// The person's clicks on a task (CHAT-09 items 13–16), the server's.
const cardActions = vi.hoisted(() => ({
  markTaskDoneFromCard: vi.fn(),
  attachOnlyFromCard: vi.fn(),
  undoTaskDoneFromCard: vi.fn(),
}));
vi.mock('@/lib/actions/chat-task-card', () => cardActions);
const plan = vi.hoisted(() => ({ locked: false, openUpgrade: vi.fn() }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({
    isLocked: plan.locked,
    openUpgrade: plan.openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        plan.locked ? plan.openUpgrade(options.action) : fn(...args),
  }),
}));

// The Send dialog loads on the click (version-send.tsx): here, what it was opened for.
vi.mock('./version-send', () => ({
  VersionSendDialog: ({ draftId, onClose }: { draftId: string; onClose: () => void }) => (
    <div data-slot="version-send" data-draft={draftId}>
      <button type="button" data-action="test.closeSend" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

const { DeliverableCard, filedNumbers } = await import('./deliverable-card');

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

async function render(
  deliverable: ChatDeliverable = page,
  props: { canChange?: boolean; onTasks?: (strip: ChatTaskStrip) => void } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DeliverableCard runId={RUN} n={2} deliverable={deliverable} {...props} />
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
  toast.success.mockClear();
  plan.locked = false;
  plan.openUpgrade.mockClear();
  for (const fn of Object.values(cardActions)) fn.mockReset();
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
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.any(Number) }),
      'pricing-faq-2026-10-30.md',
    );
    expect(toast).toHaveBeenCalledWith('Downloaded pricing-faq-2026-10-30.md');
  });

  it('copies through a clipboard item written within the click, as Safari needs, and says when it can’t', async () => {
    const write = vi.fn(async (items: { types: Record<string, Promise<Blob>> }[]) => {
      await items[0].types['text/plain'];
    });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public types: Record<string, Promise<Blob>>) {}
      },
    );
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write, writeText: vi.fn() } });
    await render();
    await click(action('deliverable.copy')!);
    expect(write).toHaveBeenCalledTimes(1);
    const blob = await (write.mock.calls[0][0][0] as { types: Record<string, Promise<Blob>> })
      .types['text/plain'];
    // jsdom's Blob has no text(): read as the browser would.
    const copied = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(copied).toBe('# Pricing FAQ');
    expect(toast).toHaveBeenCalledWith('Copied');

    fetchMock.mockImplementationOnce(async () => new Response('Not found', { status: 404 }));
    await click(action('deliverable.copy')!);
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy that. Try again.");
  });

  it('numbers only the filed ones, as the server counts their files', () => {
    const made = (filed?: ChatDeliverable['filed']): ChatDeliverable => ({ ...page, filed });
    expect(
      filedNumbers([
        made('storage_full'),
        made('in_files'),
        made('failed'),
        made(),
        made('in_files'),
      ]),
    ).toEqual([null, 1, null, 2, 3]);
  });

  it('says it wasn’t saved when storage is full, with nothing to download', async () => {
    await render({ ...page, href: undefined, filed: 'storage_full' });
    expect(container.textContent).toContain('Document · Not saved to Files · Storage is full');
    expect(action('deliverable.download')).toBeNull();
    expect(action('deliverable.copy')).toBeNull();
    expect(action('deliverable.openEditor')).toBeNull();
    // No Get more window here (Chat off, self-hosted): only the line.
    expect(action('deliverable.getMoreStorage')).toBeNull();
  });

  it('offers Get more storage when storage is full, where the window is', async () => {
    getMore.open = vi.fn();
    await render({ ...page, href: undefined, filed: 'storage_full' });
    await click(action('deliverable.getMoreStorage')!);
    expect(getMore.open).toHaveBeenCalledWith('storage');
    getMore.open = null;
  });
});

describe('DeliverableCard and its task (CHAT-09 items 12–16)', () => {
  const forTask: ChatDeliverable = {
    ...page,
    task: { title: 'Add FAQ block + schema to /pricing', state: 'open' },
  };
  const strip: ChatTaskStrip = {
    tasks: [
      {
        at: 1,
        title: 'Add FAQ block + schema to /pricing',
        priority: 86,
        category: 'fix',
        status: 'done',
      },
    ],
    ready: 1,
    total: 1,
    due: 1,
  };
  const done = { ok: true, status: 'done', task: { ...forTask.task, state: 'done' }, strip };

  it('names its task, and marks it done by the person’s click, with Undo in the toast', async () => {
    const onTasks = vi.fn();
    cardActions.markTaskDoneFromCard.mockResolvedValue(done);
    cardActions.undoTaskDoneFromCard.mockResolvedValue({
      ok: true,
      status: 'draft',
      task: forTask.task,
      strip: { ...strip, ready: 0, tasks: [{ ...strip.tasks[0], status: 'queued' }] },
    });
    await render(forTask, { canChange: true, onTasks });
    expect(container.querySelector('[data-slot="deliverable-task"]')?.textContent).toBe(
      'Task: Add FAQ block + schema to /pricing',
    );
    await click(action('deliverable.attachAndMarkDone')!);
    // The card names its file by its run and place only.
    expect(cardActions.markTaskDoneFromCard).toHaveBeenCalledWith(RUN, 2);
    expect(onTasks).toHaveBeenCalledWith(strip);
    expect(container.querySelector('[data-slot="task-done"]')?.textContent).toBe(
      'Done · attached to task',
    );
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
    const [message, options] = toast.success.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('Task marked done in Action Center');
    expect(options.action.label).toBe('Undo');
    await act(async () => options.action.onClick());
    expect(cardActions.undoTaskDoneFromCard).toHaveBeenCalledWith(RUN, 2);
    expect(toast).toHaveBeenCalledWith('Task open again in Action Center');
    expect(action('deliverable.attachAndMarkDone')).not.toBeNull();
  });

  it('attaches only from its ⋯ menu, leaving the task open', async () => {
    cardActions.attachOnlyFromCard.mockResolvedValue({
      ok: true,
      status: 'attached',
      task: forTask.task,
      strip: null,
    });
    await render(forTask, { canChange: true });
    await click(action('deliverable.more')!);
    await click(document.querySelector('[data-action="deliverable.attachOnly"]')!);
    expect(cardActions.attachOnlyFromCard).toHaveBeenCalledWith(RUN, 2);
    expect(toast).toHaveBeenCalledWith('Attached to the task');
    // Attached now: Mark done stays, the ⋯ menu goes.
    expect(action('deliverable.attachAndMarkDone')).not.toBeNull();
    expect(action('deliverable.more')).toBeNull();
  });

  it('says why a click didn’t go through, and opens the plan dialog in a read-only workspace', async () => {
    cardActions.markTaskDoneFromCard.mockResolvedValueOnce({ ok: false, failure: 'changed' });
    await render(forTask, { canChange: true });
    await click(action('deliverable.attachAndMarkDone')!);
    expect(toast.error).toHaveBeenCalledWith(
      'It changed in Action Center since, so nothing was undone.',
    );
    cardActions.markTaskDoneFromCard.mockResolvedValueOnce({ ok: false, failure: 'read_only' });
    await click(action('deliverable.attachAndMarkDone')!);
    expect(plan.openUpgrade).toHaveBeenCalledWith('Marking a task done needs a plan');
    plan.locked = true;
    await render(forTask, { canChange: true });
    await click(action('deliverable.attachAndMarkDone')!);
    expect(cardActions.markTaskDoneFromCard).toHaveBeenCalledTimes(2);
    expect(plan.openUpgrade).toHaveBeenLastCalledWith('Marking a task done needs a plan');
  });

  it('shows the task to everyone, its buttons only to an Admin or a Manager', async () => {
    await render(forTask);
    expect(container.querySelector('[data-slot="deliverable-task"]')).not.toBeNull();
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
    expect(action('deliverable.more')).toBeNull();
  });

  it('says a task Action Center has done, with or without this file', async () => {
    await render(
      { ...forTask, status: 'done', task: { ...forTask.task!, state: 'done' } },
      {
        canChange: true,
      },
    );
    expect(container.querySelector('[data-slot="task-done"]')?.textContent).toBe(
      'Done · attached to task',
    );
    // A card of its own: what the first one kept doesn't carry over.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...forTask, task: { ...forTask.task!, state: 'done' } }, { canChange: true });
    expect(container.querySelector('[data-slot="task-done"]')?.textContent).toBe(
      'Done in Action Center',
    );
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
  });

  it('offers no task controls on a card without a task', async () => {
    await render(page, { canChange: true });
    expect(container.querySelector('[data-slot="deliverable-task"]')).toBeNull();
    expect(action('deliverable.attachAndMarkDone')).toBeNull();
  });
});

describe('DeliverableCard for a set of images (W4-08, CHAT-15 items 21–22)', () => {
  const images: ChatDeliverable = {
    title: 'Cover image · GEO strategies',
    type: 'image',
    formats: ['jpg'],
    status: 'draft',
    filed: 'in_files',
  };
  const base = `/api/chat/runs/${RUN}/files/2/images`;
  let picked: number[];

  function serve(set: { count: number; selected: number; mine: boolean } | null, pickOk = true) {
    picked = [];
    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
      if (url === base && init?.method === 'POST') {
        picked.push(JSON.parse(String(init.body)).image);
        return new Response(JSON.stringify({ ok: pickOk }), { status: pickOk ? 200 : 500 });
      }
      if (url === base) {
        return set
          ? new Response(JSON.stringify({ ok: true, ...set }), { status: 200 })
          : new Response(JSON.stringify({ ok: false }), { status: 404 });
      }
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }) as never);
  }
  const shown = () =>
    [...container.querySelectorAll('[data-slot="image-set"] [data-image]')].map((el) => ({
      image: el.getAttribute('data-image'),
      selected: el.getAttribute('data-selected') === 'true',
      src: el.querySelector('img')?.getAttribute('src'),
    }));
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  afterEach(() => fetchMock.mockReset());

  it('shows every image, the selected one marked, and PNG in place of Copy and Download', async () => {
    serve({ count: 4, selected: 1, mine: true });
    await render(images);
    await settle();
    expect(container.textContent).toContain('Cover image · GEO strategies');
    expect(container.textContent).toContain('Image · In Files');
    expect(shown()).toEqual(
      [1, 2, 3, 4].map((n) => ({ image: String(n), selected: n === 1, src: `${base}/${n}` })),
    );
    expect(action('deliverable.copy')).toBeNull();
    expect(action('deliverable.download')).toBeNull();
    expect(action('deliverable.png')).not.toBeNull();
  });

  it('picks another image in the person’s own chat, and puts it back when that fails', async () => {
    serve({ count: 4, selected: 1, mine: true });
    await render(images);
    await settle();
    await click(container.querySelector('[data-image="3"]')!);
    expect(picked).toEqual([3]);
    expect(shown().find((s) => s.selected)?.image).toBe('3');

    serve({ count: 4, selected: 3, mine: true }, false);
    await click(container.querySelector('[data-image="2"]')!);
    expect(picked).toEqual([2]);
    expect(shown().find((s) => s.selected)?.image).toBe('3');
    expect(toast.error).toHaveBeenCalledWith("Couldn't pick that image. Try again.");
  });

  it('lets a teammate of a shared chat look, never pick', async () => {
    serve({ count: 2, selected: 2, mine: false });
    await render(images);
    await settle();
    const first = container.querySelector('[data-image="1"]') as HTMLButtonElement;
    expect(first.disabled).toBe(true);
    await click(first);
    expect(picked).toEqual([]);
  });

  it('downloads the selected image, named after the set', async () => {
    serve({ count: 4, selected: 2, mine: true });
    await render(images);
    await settle();
    await click(action('deliverable.png')!);
    expect(fetchMock).toHaveBeenCalledWith(`${base}/2`);
    // jsdom draws no canvas: the image is saved as it came. (Node's own Blob on Node 20, not
    // jsdom's: read by its fields, not its class.)
    const [saved, name] = download.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('cover-image-geo-strategies.jpg');
    expect(saved.size).toBe(2);
    expect(toast).toHaveBeenCalledWith('Downloaded cover-image-geo-strategies.jpg');
  });

  it('says the images are in Files when it can’t show them', async () => {
    serve(null);
    await render(images);
    await settle();
    expect(container.textContent).toContain("Couldn't show the images. They are in Files.");
  });
});

describe('DeliverableCard for a page’s version (CHAT-25 §6, W4-12a)', () => {
  const version = (n: number, extra: Partial<NonNullable<ChatDeliverable['version']>> = {}) => ({
    n,
    counts: { questions: 3, sections: 3, characters: 1250 },
    changes: {
      shortened: [{ heading: 'Can I change plans?', before: 212, after: 27 }],
      added: ['Can I get a refund?'],
      placeholders: ['[REFUND PERIOD]'],
    },
    sections: [
      { heading: 'Which AI platforms does it track?', text: 'Starter: ChatGPT and Copilot.' },
      { heading: 'Can I change plans?', text: 'Yes, any time from Billing.' },
      { heading: 'Can I get a refund?', text: 'Yes, within [REFUND PERIOD].' },
    ],
    ...extra,
  });
  const versionCard = (n = 2, extra = {}): ChatDeliverable => ({
    ...page,
    version: version(n, n > 1 ? { canUndo: true, ...extra } : extra),
  });

  it('says its version and what changed, and previews its first questions', async () => {
    await render(versionCard());
    expect(container.textContent).toContain('Version 2 · 3 questions · 1,250 characters');
    expect(container.textContent).not.toContain('Document · In Files');
    const changes = container.querySelector('[data-slot="version-changes"]')!.textContent;
    expect(changes).toContain('“Can I change plans?” shortened: 212 → 27 characters');
    expect(changes).toContain('New question: “Can I get a refund?”');
    expect(changes).toContain('1 placeholder to fill: [REFUND PERIOD]');
    const preview = () => container.querySelectorAll('[data-slot="version-preview"] dt');
    expect(preview()).toHaveLength(2);
    await click(action('version.showAll')!);
    expect(preview()).toHaveLength(3);
    expect(action('version.showAll')!.textContent).toBe('Show less');
    expect(container.textContent).toContain('Saved to the Library as a draft after each change');
  });

  it('shows a first version’s placeholders only, with nothing to undo', async () => {
    await render(versionCard(1));
    expect(container.textContent).toContain('Version 1 · 3 questions');
    const changes = container.querySelector('[data-slot="version-changes"]')!.textContent;
    expect(changes).toContain('[REFUND PERIOD]');
    expect(changes).not.toContain('shortened');
    expect(action('version.undo')).toBeNull();
  });

  it('puts the version before back, by the run’s n-th file', async () => {
    fetchMock.mockImplementationOnce(async () => Response.json({ ok: true }));
    await render(versionCard());
    await click(action('version.undo')!);
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/runs/${RUN}/files/2/undo`, {
      method: 'POST',
    });
    expect(toast).toHaveBeenCalledWith('Version 1 is back in the draft.');
    expect(action('version.undo')!.textContent).toBe('Back to version 1');
    expect(action('version.undo')!.hasAttribute('disabled')).toBe(true);
  });

  it('says when it couldn’t, and opens the plan dialog in a read-only workspace', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 404 }));
    await render(versionCard());
    await click(action('version.undo')!);
    expect(toast.error).toHaveBeenCalledWith(
      'The version before couldn’t be put back. Try again from the editor’s History.',
    );
    plan.locked = true;
    fetchMock.mockClear();
    await render(versionCard(3));
    await click(action('version.undo')!);
    expect(plan.openUpgrade).toHaveBeenCalledWith(messages.readOnly.actions.restoreVersion);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the page to the CMS from its card, for an Admin or a Manager in their chat (W4-12b)', async () => {
    const DRAFT_ID = '55555555-5555-4555-8555-555555555555';
    const card = { ...versionCard(), href: `/dashboard/content/editor/${DRAFT_ID}` as const };
    await render(card);
    expect(action('version.sendToCms')).toBeNull();
    await render(card, { canChange: true });
    await click(action('version.sendToCms')!);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.querySelector('[data-slot="version-send"]')?.getAttribute('data-draft')).toBe(
      DRAFT_ID,
    );
    expect(action('version.sendToCms')!.hasAttribute('disabled')).toBe(true);
    await click(action('test.closeSend')!);
    expect(container.querySelector('[data-slot="version-send"]')).toBeNull();
    // A read-only workspace: the plan dialog, no Send dialog.
    plan.locked = true;
    await click(action('version.sendToCms')!);
    expect(plan.openUpgrade).toHaveBeenCalledWith(messages.readOnly.actions.sendToCms);
    expect(container.querySelector('[data-slot="version-send"]')).toBeNull();
  });

  it('keeps saying it wasn’t saved to Files, with no Undo, when storage is full', async () => {
    await render({ ...versionCard(), filed: 'storage_full' });
    expect(container.textContent).toContain('Document · Not saved to Files · Storage is full');
    expect(action('version.undo')).toBeNull();
  });
});
