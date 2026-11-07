import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider } from '@/components/providers/role-provider';
import { chatEvent, type ChatEvent } from '@/lib/chat/events';
import type { ChatThread } from '@/lib/chat/thread';

/**
 * Chat's page view (Wave 1 wiring): the composer sends to the run API with
 * the person's mode and files, the answer streams in as RunAnswer, Steer
 * stops the run first, a question card is answered from the card or the
 * composer, the latest answer's next moves send their prompt and give the
 * composer its ghost, and a teammate's shared chat is read only.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => nav,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const gate = vi.hoisted(() => {
  const state = {
    isLocked: false,
    openUpgrade: vi.fn(),
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options?: { action?: string }) =>
      (...args: Args) =>
        state.isLocked ? state.openUpgrade(options?.action) : fn(...args),
  };
  return state;
});
vi.mock('@/components/providers/upgrade-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/providers/upgrade-gate')>()),
  useUpgradeGate: () => gate,
}));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));
// A deliverable's task clicks (W2-12): the server's, not these tests'.
vi.mock('@/lib/actions/chat-task-card', () => ({
  markTaskDoneFromCard: vi.fn(),
  attachOnlyFromCard: vi.fn(),
  undoTaskDoneFromCard: vi.fn(),
}));
vi.mock('@/lib/actions/chat-references', () => ({
  searchChatReferences: vi.fn(async () => ({ ok: true, references: [] })),
}));
vi.mock('@/lib/chat/upload-client', () => ({ uploadChatFile: vi.fn(), dropChatUpload: vi.fn() }));
const prefs = vi.hoisted(() => ({ saveGeneral: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveUsageNoticePeriod: vi.fn(async () => ({ ok: true })),
  saveChatGeneralSettings: prefs.saveGeneral,
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (s: { activeBrandId: string }) => unknown) =>
    selector({ activeBrandId: '22222222-2222-4222-8222-222222222222' }),
}));
const aiUsage = vi.hoisted(() => ({
  usage: null as Record<string, unknown> | null,
  refresh: vi.fn(),
}));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: aiUsage.usage, refresh: aiUsage.refresh }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ChatThreadView } = await import('./chat-thread-view');
const { PageChipContext } = await import('./page-chip');
const { uploadChatFile } = await import('@/lib/chat/upload-client');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

/** A run's answer as the API streams it, ending finished. */
function stream(events: ChatEvent[]): ReadableStream<Uint8Array> {
  const text = events
    .map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
const finished = [
  chatEvent('text.delta', 1, { text: 'Two pages lost most of it.' }),
  chatEvent('run.finished', 2, {
    workingMs: 8000,
    stepCount: 0,
    sources: [],
    generatedAt: '2026-10-30T09:14:00.000Z',
    dataAsOf: null,
  }),
];

let calls: { url: string; init?: RequestInit }[];
/** The run API: a new run streams `finished`; anything else answers {}. */
async function runApi(url: string, init?: RequestInit) {
  calls.push({ url, init });
  if (url === '/api/chat/runs') {
    return new Response(stream(finished), {
      status: 200,
      headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
    });
  }
  return new Response('{}', { status: 200 });
}
const fetchMock = vi.fn(runApi);

let container: HTMLDivElement;
let root: Root;

async function render(props: Partial<Parameters<typeof ChatThreadView>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role="admin">
          <ChatThreadView
            thread={null}
            variant="home"
            defaultMode="ask_first"
            fullAutoOpen={false}
            {...props}
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}
const box = () => container.querySelector('textarea')!;
async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function enter() {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

// A localStorage that works on every Node (CI's Node 20 has jsdom's, newer ones may
// not), emptied before each test: a page choice one test keeps can't hide another's card.
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

beforeEach(() => {
  store.clear();
  aiUsage.usage = null;
  aiUsage.refresh.mockClear();
  calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(runApi);
  toast.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/dashboard/chat');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ChatThreadView', () => {
  it('starts a chat from Home with the person’s mode and brand, and streams the answer in', async () => {
    await render();
    expect(box().rows).toBe(2);
    expect(container.querySelector('[data-action="composer.openMode"]')!.textContent).toBe(
      'Ask me first ▾',
    );
    await type('Why did citations drop?');
    await enter();
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Why did citations drop?',
      mode: 'ask_first',
      brandId: '22222222-2222-4222-8222-222222222222',
    });
    expect(container.textContent).toContain('Why did citations drop?');
    expect(container.textContent).toContain('Two pages lost most of it.');
    // Stamped in the person's own time zone.
    expect(container.textContent).toContain('Generated Oct 30, 2026 · ');
    expect(window.location.pathname).toBe(`/dashboard/chat/${CHAT}`);
  });

  it('shows the files a question was sent with: an image as a thumbnail, another as a chip', async () => {
    const message = (role: 'user' | 'assistant', text: string, extra: object = {}) => ({
      role,
      text,
      generatedAt: null,
      dataAsOf: null,
      timezone: null,
      run: null,
      ...extra,
    });
    await render({
      variant: 'dock',
      thread: {
        conversationId: CHAT,
        title: 'chart.png',
        brandId: null,
        mine: true,
        messages: [
          message('user', '', {
            resendable: false,
            attachments: [
              { id: 'u1', name: 'chart.png', mimeType: 'image/png', sizeBytes: 2048 },
              { id: 'u2', name: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 4096 },
            ],
          }),
          message('assistant', 'A chart and a brief.'),
          message('user', 'And this one?', {
            resendable: false,
            attachments: [{ id: 'u3', name: 'data.csv', mimeType: 'text/csv', sizeBytes: 10 }],
          }),
          message('assistant', 'A table.'),
        ],
      },
    });
    const [filesOnly, , withText] = [...container.querySelectorAll('ol > li')];
    const image = filesOnly.querySelector<HTMLImageElement>('[data-slot="sent-files"] img')!;
    expect(image.getAttribute('src')).toBe('/api/chat/uploads/u1');
    expect(image.alt).toBe('chart.png');
    expect(image.closest('a')!.getAttribute('aria-label')).toBe('Open chart.png');
    expect(image.closest('a')!.getAttribute('target')).toBe('_blank');
    expect(filesOnly.querySelector('[data-kind="file"]')!.textContent).toBe('PDFbrief.pdf');
    // Files alone: no empty bubble under them.
    expect(filesOnly.querySelector('.rounded-2xl')).toBeNull();
    expect(withText.querySelector('[data-kind="file"]')!.textContent).toBe('CSVdata.csv');
    expect(withText.querySelector('.rounded-2xl')!.textContent).toBe('You: And this one?');
  });

  it('sends an image with no text, and shows it in the question at once', async () => {
    const UPLOAD = '55555555-5555-4555-8555-555555555555';
    vi.mocked(uploadChatFile).mockResolvedValueOnce({ ok: true, id: UPLOAD });
    await render({ variant: 'dock' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const png = new File(['x'], 'chart.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [png] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await enter();
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: '',
      attachmentIds: [UPLOAD],
    });
    const question = container.querySelector('ol > li')!;
    expect(
      question.querySelector<HTMLImageElement>('[data-slot="sent-files"] img')!.getAttribute('src'),
    ).toBe(`/api/chat/uploads/${UPLOAD}`);
    expect(question.querySelector('.rounded-2xl')).toBeNull();
  });

  it('in the side panel, keeps the page’s address and tells the panel the chat', async () => {
    window.history.replaceState(null, '', '/dashboard/mentions');
    const onConversation = vi.fn();
    await render({
      variant: 'panel',
      onConversation,
      empty: <p>Hi Sam, ask anything about this page.</p>,
    });
    expect(container.textContent).toContain('Hi Sam, ask anything about this page.');
    await type('Why did mentions drop?');
    await enter();
    expect(window.location.pathname).toBe('/dashboard/mentions');
    expect(onConversation).toHaveBeenCalledWith(CHAT);
    expect(container.textContent).not.toContain('Hi Sam');
  });

  it('puts what the panel hands it under the latest turn once nothing runs, and sends from it', async () => {
    window.history.replaceState(null, '', '/dashboard/prompts');
    const tourThread: ChatThread = {
      conversationId: CHAT,
      title: 'Ansvisor tour',
      brandId: null,
      mine: true,
      messages: [
        {
          role: 'user',
          text: 'Show me Visibility',
          generatedAt: null,
          dataAsOf: null,
          timezone: null,
          run: null,
        },
        {
          role: 'assistant',
          text: 'I’ve opened **Visibility**.',
          generatedAt: null,
          dataAsOf: null,
          timezone: null,
          run: null,
        },
      ],
    };
    await render({
      thread: tourThread,
      variant: 'panel',
      onConversation: vi.fn(),
      chips: [{ key: 'page', label: 'Prompts' }],
      afterLast: ({ send, disabled }) => (
        <button
          type="button"
          data-testid="after"
          disabled={disabled}
          onClick={() => send('Suggest prompts for me')}
        >
          after
        </button>
      ),
    });
    const after = container.querySelector<HTMLButtonElement>('[data-testid="after"]')!;
    expect(after).not.toBeNull();
    // A scripted answer, with no run: no stamp.
    expect(container.textContent).not.toContain('Generated');
    await act(async () => after.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Suggest prompts for me',
      conversationId: CHAT,
    });
    // While the run works, and after it, as the latest turn: it comes back once it ends.
    expect(container.querySelector('[data-testid="after"]')).not.toBeNull();
  });

  it('puts the slot under the turn it is given, and marks a turn', async () => {
    const m = (role: 'user' | 'assistant', text: string) => ({
      role,
      text,
      generatedAt: null,
      dataAsOf: null,
      timezone: null,
      run: null,
    });
    await render({
      thread: {
        conversationId: CHAT,
        title: 'Ansvisor tour',
        brandId: null,
        mine: true,
        messages: [
          m('user', 'Show me Visibility'),
          m('assistant', 'Visibility.'),
          m('user', 'Next: Content'),
          m('assistant', 'Content.'),
        ],
      },
      variant: 'panel',
      onConversation: vi.fn(),
      afterLast: () => <span data-testid="after">after</span>,
      afterTurn: 1,
      markedTurn: 1,
    });
    const items = [...container.querySelectorAll('ol > li')];
    expect(items.map((li) => li.getAttribute('data-slot') ?? li.textContent)).toEqual([
      'You: Show me Visibility',
      expect.stringContaining('Visibility.'),
      'after-turn',
      'You: Next: Content',
      expect.stringContaining('Content.'),
    ]);
    expect(items[1].hasAttribute('data-marked')).toBe(true);
    expect(items[4].hasAttribute('data-marked')).toBe(false);
  });

  it('sends the page’s chips and the @ objects with the message, as its scope (W1-08)', async () => {
    const chart = { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' };
    await render({
      variant: 'panel',
      onConversation: vi.fn(),
      chips: [
        { key: 'page', label: 'Mentions & Sentiment' },
        { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
      ],
      pageRoute: '/dashboard/mentions',
      draft: { nonce: 1, reference: chart },
    });
    await type('Why the drop?');
    await enter();
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Why the drop?',
      origin: 'panel',
      originPage: '/dashboard/mentions',
      context: {
        route: '/dashboard/mentions',
        chips: [
          { key: 'page', label: 'Mentions & Sentiment' },
          { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
        ],
      },
      references: [chart],
    });
  });

  it('puts its actions under a finished answer, In Files once filed, and what it made as cards', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: 'Two pages lost most of it.',
          generatedAt: '2026-10-30T09:14:00.000Z',
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'done',
            steps: [],
            fileId: 'f1',
            deliverables: [
              {
                title: 'Pricing FAQ',
                type: 'document',
                formats: ['html', 'md'],
                status: 'draft',
                href: '/dashboard/content/editor/d1',
                filed: 'in_files',
              },
            ],
          },
        },
      ],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    const bar = container.querySelector('[role="toolbar"][aria-label="Answer actions"]')!;
    expect(
      [...bar.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Copy', 'Download', 'In Files', 'Open in Content Editor', 'Send to Action Center']);
    // What the run made shows as its card, its page open in the editor.
    const card = container.querySelector('[data-slot="deliverable-card"]')!;
    expect(card.getAttribute('aria-label')).toBe('Pricing FAQ');
    expect(card.querySelector('a')!.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  describe('where the page it wrote opens (CHAT-25 §3, W4-11)', () => {
    const DRAFT = 'aaaaaaaa-1111-4111-8111-111111111111';
    const pageThread = (mine = true, href = '/dashboard/content/editor/d1') =>
      ({
        conversationId: CHAT,
        title: 'Pricing FAQ',
        brandId: null,
        mine,
        messages: [
          { role: 'user', text: 'Write an FAQ', generatedAt: null, dataAsOf: null, timezone: null },
          {
            role: 'assistant',
            text: 'Here is the FAQ.',
            generatedAt: '2026-10-30T09:14:00.000Z',
            dataAsOf: null,
            timezone: 'UTC',
            run: {
              runId: RUN,
              status: 'done',
              steps: [],
              fileId: null,
              deliverables: [
                {
                  title: 'Pricing FAQ',
                  type: 'document',
                  formats: ['html'],
                  status: 'draft',
                  href,
                },
              ],
            },
          },
        ],
      }) as unknown as ChatThread;
    const pageCard = () => container.querySelector('[data-slot="open-page-card"]');
    const pick = (name: string) =>
      container.querySelector<HTMLElement>(`[data-action="openPage.${name}"]`)!;
    beforeEach(() => {
      nav.push.mockReset();
      nav.refresh.mockReset();
      prefs.saveGeneral.mockClear();
    });

    it('asks under the answer, and keeps working in chat without saving a choice', async () => {
      await render({ thread: pageThread(), variant: 'dock' });
      expect(pageCard()!.textContent).toContain('Where should we open this page?');
      await act(async () => pick('chat').click());
      expect(pageCard()).toBeNull();
      expect(prefs.saveGeneral).not.toHaveBeenCalled();
      expect(nav.push).not.toHaveBeenCalled();
      expect(nav.refresh).not.toHaveBeenCalled();
    });

    it('opens the editor, and keeps the choice when asked not to ask again', async () => {
      await render({ thread: pageThread(), variant: 'dock' });
      await act(async () => pick('dontAskAgain').click());
      await act(async () => pick('editor').click());
      expect(prefs.saveGeneral).toHaveBeenCalledWith({ pageOpen: 'editor' });
      expect(toast).toHaveBeenCalledWith(
        'Your choice is saved. Change it anytime in Settings › Chat.',
      );
      expect(nav.push).toHaveBeenCalledWith('/dashboard/content/editor/d1');
      // The layout's setup (the side panel's) is read again with the choice.
      expect(nav.refresh).toHaveBeenCalled();
      expect(pageCard()).toBeNull();
    });

    it('opens the editor by itself as a run it watched ends, with Content Editor saved', async () => {
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          stream([
            chatEvent('text.delta', 1, { text: 'Here is the FAQ.' }),
            chatEvent('deliverable.created', 2, {
              title: 'Pricing FAQ',
              type: 'document',
              formats: ['html'],
              status: 'draft',
              href: '/dashboard/content/editor/d1',
            }),
            ...finished.slice(1).map((e) => ({ ...e, seq: 3 })),
          ]),
          { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
        );
      });
      await render({ pageOpen: 'editor' });
      await type('Write an FAQ');
      await enter();
      expect(nav.push).toHaveBeenCalledWith('/dashboard/content/editor/d1');
      expect(pageCard()).toBeNull();
    });

    it('opens the page beside the chat on its own page, and keeps Open here (W4-15b)', async () => {
      window.history.replaceState(null, '', `/dashboard/chat/${CHAT}?from=%2Fdashboard%2Fmentions`);
      await render({
        thread: pageThread(true, `/dashboard/content/editor/${DRAFT}`),
        variant: 'dock',
      });
      expect(pick('here').textContent).toContain('Open here');
      await act(async () => pick('dontAskAgain').click());
      await act(async () => pick('here').click());
      expect(prefs.saveGeneral).toHaveBeenCalledWith({ pageOpen: 'here' });
      expect(toast).toHaveBeenCalledWith(
        'Your choice is saved. Change it anytime in Settings › Chat.',
      );
      // Its address names the page, the rest kept; nothing navigates away or reloads.
      expect(window.location.pathname).toBe(`/dashboard/chat/${CHAT}`);
      expect(window.location.search).toBe(`?from=%2Fdashboard%2Fmentions&page=${DRAFT}`);
      expect(nav.push).not.toHaveBeenCalled();
      expect(nav.refresh).toHaveBeenCalled();
      expect(pageCard()).toBeNull();
    });

    it('opens the page beside the chat once, without a choice kept', async () => {
      window.history.replaceState(null, '', `/dashboard/chat/${CHAT}`);
      const entries = window.history.length;
      await render({
        thread: pageThread(true, `/dashboard/content/editor/${DRAFT}`),
        variant: 'dock',
      });
      await act(async () => pick('here').click());
      expect(prefs.saveGeneral).not.toHaveBeenCalled();
      expect(window.location.search).toBe(`?page=${DRAFT}`);
      // A step back closes it again.
      expect(window.history.length).toBe(entries + 1);
      expect(nav.refresh).not.toHaveBeenCalled();
    });

    it('goes from the side panel to the chat’s full page with the page beside it', async () => {
      window.history.replaceState(null, '', '/dashboard/mentions?range=7d');
      await render({
        thread: pageThread(true, `/dashboard/content/editor/${DRAFT}`),
        variant: 'panel',
        pageRoute: '/dashboard/mentions',
      });
      await act(async () => pick('here').click());
      expect(nav.push).toHaveBeenCalledWith(
        `/dashboard/chat/${CHAT}?from=%2Fdashboard%2Fmentions%3Frange%3D7d&page=${DRAFT}`,
      );
      expect(window.location.pathname).toBe('/dashboard/mentions');
    });

    it('opens the page beside the chat from Optimize ▾’s “in the editor here” (W4-15c)', async () => {
      window.history.replaceState(null, '', `/dashboard/chat/${CHAT}`);
      const thread = pageThread(true, `/dashboard/content/editor/${DRAFT}`);
      const [, answer] = thread.messages as unknown as {
        run: { deliverables: Record<string, unknown>[] };
      }[];
      Object.assign(answer.run.deliverables[0], {
        filed: 'in_files',
        version: {
          n: 1,
          counts: { questions: 3, sections: 3, characters: 900 },
          changes: { shortened: [], added: [], placeholders: [] },
          sections: [],
        },
      });
      await render({ thread, variant: 'dock' });
      const item = (name: string) =>
        document.querySelector<HTMLElement>(`[data-action="version.${name}"]`)!;
      await act(async () => {
        item('optimize').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        item('optimize').click();
      });
      expect(item('optimizeInEditorHere').textContent).toContain('Optimize in the editor here');
      await act(async () => item('optimizeInEditorHere').click());
      // The editor's own Optimize, beside the chat: its address names the page, nothing reloads.
      expect(window.location.pathname).toBe(`/dashboard/chat/${CHAT}`);
      expect(window.location.search).toBe(`?page=${DRAFT}`);
      expect(nav.push).not.toHaveBeenCalled();
    });

    it('opens the page beside the chat by itself as a run it watched ends, with Open here saved', async () => {
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          stream([
            chatEvent('text.delta', 1, { text: 'Here is the FAQ.' }),
            chatEvent('deliverable.created', 2, {
              title: 'Pricing FAQ',
              type: 'document',
              formats: ['html'],
              status: 'draft',
              href: `/dashboard/content/editor/${DRAFT}`,
            }),
            ...finished.slice(1).map((e) => ({ ...e, seq: 3 })),
          ]),
          { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
        );
      });
      await render({ pageOpen: 'here' });
      await type('Write an FAQ');
      await enter();
      expect(pageCard()).toBeNull();
      expect(window.location.pathname).toBe(`/dashboard/chat/${CHAT}`);
      expect(window.location.search).toBe(`?page=${DRAFT}`);
      expect(nav.push).not.toHaveBeenCalled();
    });

    it('doesn’t ask with a saved choice, nor on a teammate’s chat', async () => {
      await render({ thread: pageThread(), variant: 'dock', pageOpen: 'chat' });
      expect(pageCard()).toBeNull();
      // A finished answer read back doesn't open the editor, or the page beside it, by itself.
      await render({ thread: pageThread(), variant: 'dock', pageOpen: 'editor' });
      expect(pageCard()).toBeNull();
      expect(nav.push).not.toHaveBeenCalled();
      window.history.replaceState(null, '', `/dashboard/chat/${CHAT}`);
      await render({
        thread: pageThread(true, `/dashboard/content/editor/${DRAFT}`),
        variant: 'dock',
        pageOpen: 'here',
      });
      expect(pageCard()).toBeNull();
      expect(window.location.search).toBe('');
      act(() => root.unmount());
      root = createRoot(container);
      await render({ thread: pageThread(false), variant: 'dock' });
      expect(pageCard()).toBeNull();
    });
  });

  it('keeps the box at the bottom of the chat page, however short the chat', async () => {
    const shortChat = {
      conversationId: CHAT,
      title: 'Hi',
      brandId: null,
      mine: true,
      messages: [{ role: 'user', text: 'Hi', generatedAt: null, dataAsOf: null, timezone: null }],
    } as unknown as ChatThread;
    await render({ thread: shortChat, variant: 'dock' });
    const composer = container.querySelector('[data-slot="thread-composer"]')!;
    // Pushed down by mt-auto in a column at least the scroll area's height.
    expect(composer.className).toContain('sticky');
    expect(composer.className).toContain('mt-auto');
    expect(composer.parentElement!.className).toContain('min-h-full');
  });

  it('keeps the text when the run API refuses it', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ ok: false, error: 'Slow down a little.' }, { status: 429 });
    });
    await render();
    await type('Hello');
    await enter();
    expect(toast.error).toHaveBeenCalledWith('Slow down a little.');
    expect(box().value).toBe('Hello');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('opens the plans when the run API says the chat is on the demo brand', async () => {
    gate.openUpgrade.mockClear();
    vi.mocked(toast.error).mockClear();
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json(
        { ok: false, failure: 'subscription', error: 'demo_brand', code: 'demo_brand' },
        { status: 402 },
      );
    });
    await render();
    await type('And on Gemini?');
    await enter();
    expect(gate.openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('steers a run under way: Stop first, then the text as the next message', async () => {
    const thread: ChatThread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [] },
        },
      ],
    } as unknown as ChatThread;
    // The run under way is read again from its events: still working.
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(new ReadableStream({ start: () => {} }), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await type('only blog pages');
    await enter();
    const urls = calls.map((c) => c.url);
    expect(urls.indexOf(`/api/chat/runs/${RUN}/stop`)).toBeGreaterThan(-1);
    expect(urls.indexOf(`/api/chat/runs/${RUN}/stop`)).toBeLessThan(urls.indexOf('/api/chat/runs'));
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'only blog pages',
      conversationId: CHAT,
    });
  });

  it('after a reload, still says why a run failed, and Retry sends the question again (W1-15)', async () => {
    const reason = "Chat couldn't check your AI usage just now, so it didn't start this step.";
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'error',
            steps: [],
            fileId: null,
            deliverables: [],
            summary: { workingMs: 3000, stepCount: 0, sources: [] },
            errorReason: reason,
          },
        },
      ],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    const box = container.querySelector('[data-slot="run-error"]')!;
    expect(box.textContent).toContain('Stopped: something went wrong');
    expect(box.textContent).toContain(reason);
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Find the drop',
      conversationId: CHAT,
    });
    expect(container.textContent).toContain('Two pages lost most of it.');
    // Retry is on the latest answer only: the failed one has none now.
    expect(container.querySelector('[data-slot="run-error"]')).not.toBeNull();
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();

    // A teammate's shared chat only reads: no Retry.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ thread: { ...thread, mine: false }, variant: 'dock' });
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();

    // A question sent with files or a page scope can't go again as it was: no Retry.
    const scoped = {
      ...thread,
      messages: [{ ...thread.messages[0], resendable: false }, thread.messages[1]],
    } as ChatThread;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ thread: scoped, variant: 'dock' });
    expect(container.querySelector('[data-slot="run-error"]')).not.toBeNull();
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();

    // Paused at the AI limit, the composer is off, and so is Retry.
    aiUsage.usage = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      unlimited: false,
      percentUsed: 100,
      features: [],
      chatMetered: true,
    };
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ thread, variant: 'dock' });
    expect(container.querySelector('[data-slot="run-error"]')).not.toBeNull();
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();
  });

  it('retries a question with the page chips and @ objects it was sent with', async () => {
    const chart = { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' };
    const chips = [
      { key: 'page', label: 'Mentions & Sentiment' },
      { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
    ];
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('run.error', 1, {
            workingMs: 1000,
            stepCount: 0,
            sources: [],
            code: 'failed',
            reason: 'Something went wrong, so Chat stopped here.',
          }),
        ]),
        { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
      );
    });
    await render({
      variant: 'panel',
      onConversation: vi.fn(),
      chips,
      pageRoute: '/dashboard/mentions',
      draft: { nonce: 1, reference: chart },
    });
    await type('Why the drop?');
    await enter();
    const retry = container.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!;
    await act(async () => retry.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls.filter((c) => c.url === '/api/chat/runs');
    expect(sent).toHaveLength(2);
    const [first, again] = sent.map((c) => JSON.parse(String(c.init!.body)));
    expect(again).toMatchObject({
      message: 'Why the drop?',
      conversationId: CHAT,
      context: { route: '/dashboard/mentions', chips },
      references: [chart],
    });
    expect(again.context).toEqual(first.context);
    expect(again.references).toEqual(first.references);
    expect(again.attachmentIds).toBeUndefined();
  });

  it('sends the shortcut picked from the / menu with its message, and again on Retry (W2-09)', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('run.error', 1, {
            workingMs: 1000,
            stepCount: 0,
            sources: [],
            code: 'failed',
            reason: 'Something went wrong, so Chat stopped here.',
          }),
        ]),
        { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
      );
    });
    await render({ variant: 'panel', onConversation: vi.fn() });
    await type('/an');
    await enter();
    expect(box().value).toBe('Analyze ');
    await type('Analyze the mentions drop');
    await enter();
    const retry = container.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!;
    await act(async () => retry.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls
      .filter((c) => c.url === '/api/chat/runs')
      .map((c) => JSON.parse(String(c.init!.body)));
    expect(sent.map((body) => [body.message, body.shortcutId])).toEqual([
      ['Analyze the mentions drop', 'analyze'],
      ['Analyze the mentions drop', 'analyze'],
    ]);
  });

  it('stops following a run once the view goes: no reconnect, no warning', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [], fileId: null, deliverables: [] },
        },
      ],
    } as unknown as ChatThread;
    // The stream ends with no end: the view would reconnect after a second.
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(stream([]), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.textContent).toContain('Reconnecting…');
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it('cancels a stream still open once the view goes', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [], fileId: null, deliverables: [] },
        },
      ],
    } as unknown as ChatThread;
    const cancel = vi.fn();
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(new ReadableStream({ start: () => {}, cancel }), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalled();
    root = createRoot(container);
  });

  it('says "Reconnecting…" when the stream drops, and resumes after the last event', async () => {
    const started = chatEvent('step.started', 1, {
      step: { n: 1, kind: 'read', label: 'Read Citations', status: 'running' },
    });
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      // The connection breaks after the first events, with no end.
      const text = [started, chatEvent('text.delta', 2, { text: 'Two pages ' })]
        .map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join('');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          setTimeout(() => controller.error(new TypeError('network error')), 0);
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
      });
    });
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('step.finished', 3, {
            step: { n: 1, kind: 'read', label: 'Read Citations', status: 'done', rowCount: 18 },
          }),
          chatEvent('text.delta', 4, { text: 'lost most of it.' }),
          chatEvent('run.finished', 5, {
            workingMs: 8000,
            stepCount: 1,
            sources: [{ label: 'Citations', count: 18 }],
            generatedAt: '2026-10-30T09:14:00.000Z',
            dataAsOf: null,
          }),
        ]),
        { status: 200 },
      );
    });
    await render();
    await type('Why did citations drop?');
    await enter();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const header = () => container.querySelector('[data-action="answer.toggleSteps"]')!;
    expect(header().textContent).toContain('Reconnecting…');
    expect(container.textContent).toContain('Two pages');

    await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(calls.map((c) => c.url)).toContain(`/api/chat/runs/${RUN}/events?after=2`);
    expect(container.textContent).not.toContain('Reconnecting…');
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(header().textContent).toContain('Read Citations');
  });

  it('after a reload, shows the kept steps and keeps streaming from the run’s events', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'running',
            steps: [{ n: 1, kind: 'read', label: 'Read Citations', status: 'running' }],
            fileId: null,
            deliverables: [],
            summary: null,
            errorReason: null,
          },
        },
      ],
    } as unknown as ChatThread;
    let open: ReadableStreamDefaultController<Uint8Array> | null = null;
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            open = controller;
          },
        }),
        { status: 200 },
      );
    });
    await render({ thread, variant: 'dock' });
    // The kept step shows while the events come.
    expect(container.textContent).toContain('Read Citations');
    expect(calls.map((c) => c.url)).toContain(`/api/chat/runs/${RUN}/events?after=0`);
    const frame = (e: ChatEvent) =>
      new TextEncoder().encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    await act(async () => {
      open!.enqueue(
        frame(
          chatEvent('step.started', 1, {
            step: { n: 1, kind: 'read', label: 'Read Citations', status: 'running' },
          }),
        ),
      );
      open!.enqueue(frame(chatEvent('text.delta', 2, { text: 'Two pages lost most of it.' })));
      open!.enqueue(frame({ ...finished[1], seq: 3 }));
      open!.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(container.textContent).toContain('Generated Oct 30, 2026');
  });

  describe('a question card (CHAT-07)', () => {
    /** Its place among the questions asked together, when there are more. */
    let batch: { at: number; of: number } | undefined;
    const asked = () => [
      chatEvent('step.started', 1, {
        step: { n: 1, kind: 'ask', status: 'waiting', label: 'Waiting for your answer' },
      }),
      chatEvent('ask.created', 2, {
        n: 1,
        question: 'Which page should the FAQ go on?',
        options: [
          { label: '/pricing', recommended: true },
          { label: '/features', recommended: false },
        ],
        allowOther: false,
        multi: false,
        ...(batch ? { batch } : {}),
      }),
    ];
    const goesOn = (answer: string) => [
      chatEvent('step.finished', 3, {
        step: {
          n: 1,
          kind: 'ask',
          status: 'done',
          label: 'Which page should the FAQ go on?',
          detail: answer,
        },
      }),
      chatEvent('text.delta', 4, { text: 'Writing it.' }),
      chatEvent('run.finished', 5, {
        workingMs: 8000,
        stepCount: 1,
        sources: [],
        generatedAt: '2026-10-30T09:14:00.000Z',
        dataAsOf: null,
      }),
    ];
    beforeEach(() => {
      batch = undefined;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/chat/runs') {
          return new Response(stream(asked()), {
            status: 200,
            headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
          });
        }
        if (url.startsWith(`/api/chat/runs/${RUN}/events`)) {
          // After a Stop: the question's step skipped, and the run stopped.
          return new Response(
            stream([
              chatEvent('step.finished', 3, {
                step: {
                  n: 1,
                  kind: 'ask',
                  status: 'skipped',
                  label: 'Question skipped',
                  detail: 'Stopped',
                },
              }),
              chatEvent('run.stopped', 4, {
                workingMs: 4000,
                stepCount: 1,
                sources: [],
                reason: 'person',
              }),
            ]),
            { status: 200 },
          );
        }
        if (url.startsWith(`/api/chat/runs/${RUN}/answer`)) {
          const body = JSON.parse(String(init!.body)) as { selected: number[]; other?: string };
          return new Response(
            stream(goesOn(body.other ?? ['/pricing', '/features'][body.selected[0]])),
            {
              status: 200,
            },
          );
        }
        return new Response('{}', { status: 200 });
      });
    });
    afterEach(() => {
      fetchMock.mockImplementation(runApi);
    });

    it('waits on the card, sends its answer to the run and folds it to one line', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      const card = container.querySelector('[data-slot="question-card"]')!;
      expect(card.querySelector('h3')!.textContent).toBe('Which page should the FAQ go on?');
      // The stream settled on the card: no reconnect.
      expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(0);
      // The composer offers the Recommended option as its ghost, with Send, Stop beside it,
      // and an answer's length; no files or @ data go with an answer.
      expect(
        container.querySelector('[data-action="composer.acceptGhost"]')!.textContent,
      ).toContain('/pricing');
      expect(container.querySelector('[data-action="composer.send"]')).not.toBeNull();
      expect(container.querySelector('[data-action="composer.stop"]')).not.toBeNull();
      expect(box().maxLength).toBe(500);
      expect(container.textContent).toContain("Your message answers Chat's question");
      await act(async () => {
        container.querySelectorAll<HTMLElement>('[data-action="question.pick"]')[1].click();
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="question.next"]')!.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const answer = calls.find((c) => c.url.includes('/answer'))!;
      expect(answer.url).toBe(`/api/chat/runs/${RUN}/answer?after=2`);
      expect(JSON.parse(String(answer.init!.body))).toEqual({
        n: 1,
        selected: [1],
        other: null,
        skipped: false,
        via: 'card',
      });
      expect(container.querySelector('[data-slot="question-card"]')).toBeNull();
      expect(container.querySelector('[data-slot="question-answered"]')!.textContent).toBe(
        'Which page should the FAQ go on?/features',
      );
      expect(container.textContent).toContain('Writing it.');
    });

    it('says the next question asked with it comes up', async () => {
      batch = { at: 1, of: 2 };
      await render();
      await type('Write a pricing FAQ');
      await enter();
      expect(container.querySelector('[data-slot="question-card"]')!.textContent).toContain(
        '1 of 2',
      );
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="question.next"]')!.click();
      });
      expect(toast).toHaveBeenCalledWith('Answer saved · question 2 of 2 next');
    });

    it('picks the option the composer’s message names (the ghost after Tab)', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      await type('/features');
      await enter();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const answer = calls.find((c) => c.url.includes('/answer'))!;
      expect(JSON.parse(String(answer.init!.body))).toMatchObject({
        selected: [1],
        other: null,
        via: 'composer',
      });
    });

    it('stops the run from the composer while it asks: the question is left skipped', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      await act(async () => {
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(calls.map((c) => c.url)).toContain(`/api/chat/runs/${RUN}/stop`);
      expect(container.querySelector('[data-slot="question-card"]')).toBeNull();
      expect(calls.some((c) => c.url.includes('/answer'))).toBe(false);
      // Stopped: Send again, no Stop.
      expect(container.querySelector('[data-action="composer.stop"]')).toBeNull();
    });

    it('takes the composer’s message as the answer, without a new run or a Stop', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      await type('The blog');
      await enter();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(calls.filter((c) => c.url === '/api/chat/runs')).toHaveLength(1);
      expect(calls.some((c) => c.url.endsWith('/stop'))).toBe(false);
      const answer = calls.find((c) => c.url.includes('/answer'))!;
      expect(JSON.parse(String(answer.init!.body))).toEqual({
        n: 1,
        selected: [],
        other: 'The blog',
        skipped: false,
        via: 'composer',
      });
      expect(container.querySelector('[data-slot="question-answered"]')!.textContent).toBe(
        'Which page should the FAQ go on?The blog',
      );
    });
  });

  /** CHAT-09 items 18–19: Send to Action Center on the latest answer, and what it sent. */
  describe('Send to Action Center (CHAT-09 §E)', () => {
    const answered = (run: object = {}) =>
      ({
        conversationId: CHAT,
        title: 'Citations',
        brandId: null,
        mine: true,
        messages: [
          {
            role: 'user',
            text: 'Why did AIO drop?',
            generatedAt: null,
            dataAsOf: null,
            timezone: null,
          },
          {
            role: 'assistant',
            text: 'Two pages lost most of it.',
            generatedAt: '2026-10-30T09:14:00.000Z',
            dataAsOf: null,
            timezone: 'UTC',
            run: { runId: RUN, status: 'done', steps: [], fileId: null, deliverables: [], ...run },
          },
        ],
      }) as unknown as ChatThread;
    const sendButton = () =>
      container.querySelector<HTMLElement>('[data-action="answer.sendToActionCenter"]');

    it('asks Chat to propose the latest answer as an action, on its card', async () => {
      await render({ thread: answered(), variant: 'dock' });
      await act(async () => sendButton()!.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const sent = calls.find((c) => c.url === '/api/chat/runs')!;
      expect(JSON.parse(String(sent.init!.body))).toMatchObject({
        message: 'Send this finding to Action Center as an action.',
        // The answer's run goes with it: the server reads whether it read outside text (§16a).
        fromRunId: RUN,
      });
    });

    it("isn't offered to an Analyst, or on a teammate's shared chat", async () => {
      act(() => root.unmount());
      root = createRoot(container);
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <RoleProvider role="analyst">
              <ChatThreadView
                thread={answered()}
                variant="dock"
                defaultMode="ask_first"
                fullAutoOpen={false}
              />
            </RoleProvider>
          </NextIntlClientProvider>,
        );
      });
      expect(sendButton()).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
      await render({ thread: { ...answered(), mine: false }, variant: 'dock' });
      expect(sendButton()).toBeNull();
    });

    it('shows what it sent with Open in Actions, after a reload too', async () => {
      await render({
        thread: answered({
          sent: [
            {
              kind: 'action_created',
              actionNo: 1271,
              title: 'Win back pricing citations',
              href: '/dashboard/action-center/actions/a1',
            },
          ],
        }),
        variant: 'dock',
      });
      const card = container.querySelector('[data-slot="action-sent-card"]')!;
      expect(card.textContent).toContain('Sent to Action Center · AC-1271');
      expect(card.textContent).toContain('Win back pricing citations');
      expect(card.querySelector('a')!.getAttribute('href')).toBe(
        '/dashboard/action-center/actions/a1',
      );
      expect(card.querySelector('a')!.textContent).toBe('Open in Actions');
    });
  });

  describe('next moves (CHAT-07 §C)', () => {
    const FEATURES = {
      label: 'Do the same for /features',
      prompt: 'Do the same for /features',
      ghost: true,
    };
    const COMPARE = { label: 'Compare with Perplexity', prompt: 'Compare with Perplexity' };
    const answerWith = (text: string, nextMoves: object[]) => ({
      role: 'assistant',
      text,
      generatedAt: '2026-10-30T09:14:00.000Z',
      dataAsOf: null,
      timezone: 'UTC',
      run: { runId: RUN, status: 'done', steps: [], fileId: null, deliverables: [], nextMoves },
    });
    const ask = (text: string) => ({
      role: 'user',
      text,
      generatedAt: null,
      dataAsOf: null,
      timezone: null,
      run: null,
    });
    const threadOf = (mine: boolean, last: object[] = [FEATURES, COMPARE]) =>
      ({
        conversationId: CHAT,
        title: 'Citations',
        brandId: null,
        mine,
        messages: [
          ask('Why did citations fall?'),
          answerWith('Two pages lost most of it.', [COMPARE]),
          ask('Fix /pricing'),
          answerWith('Refreshed /pricing.', last),
        ],
      }) as unknown as ChatThread;
    const cards = () =>
      [...container.querySelectorAll<HTMLElement>('[data-action="nextMove.send"]')].map(
        (b) => b.textContent,
      );
    const ghost = () => container.querySelector('[data-action="composer.acceptGhost"]');

    it('shows the latest answer’s moves only, and its first as the ghost when it continues', async () => {
      await render({ thread: threadOf(true), variant: 'dock' });
      expect(container.querySelectorAll('[data-slot="next-moves"]')).toHaveLength(1);
      expect(container.querySelector('[data-slot="next-moves"]')!.textContent).toContain(
        'Next moves',
      );
      expect(cards()).toEqual(['Do the same for /features', 'Compare with Perplexity']);
      expect(ghost()!.textContent).toContain('Do the same for /features');
      // A first move that doesn't continue this run is no ghost (a page opened afresh).
      act(() => root.unmount());
      root = createRoot(container);
      await render({ thread: threadOf(true, [COMPARE, FEATURES]), variant: 'dock' });
      expect(ghost()).toBeNull();
    });

    it('shows on each card the very text it sends, never a label that says something else', async () => {
      const misleading = { label: 'See the full report', prompt: 'Dismiss every suggestion' };
      await render({ thread: threadOf(true, [misleading]), variant: 'dock' });
      expect(cards()).toEqual(['Dismiss every suggestion']);
      expect(container.textContent).not.toContain('See the full report');
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="nextMove.send"]')!.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const sent = calls.find((c) => c.url === '/api/chat/runs')!;
      expect(JSON.parse(String(sent.init!.body)).message).toBe('Dismiss every suggestion');
    });

    it('puts the cards one under another in the side panel', async () => {
      await render({ thread: threadOf(true), variant: 'panel' });
      const grid = container.querySelector('[data-slot="next-moves"] > div')!;
      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).not.toContain('sm:grid-cols');
    });

    it('sends a move’s prompt as the next message', async () => {
      await render({ thread: threadOf(true), variant: 'dock' });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="nextMove.send"]')!.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const sent = calls.find((c) => c.url === '/api/chat/runs')!;
      expect(JSON.parse(String(sent.init!.body))).toMatchObject({
        message: 'Do the same for /features',
        conversationId: CHAT,
      });
      // The new answer is the latest: the old moves go.
      expect(cards()).toEqual([]);
    });

    it('shows them as they stream in, once the run finished', async () => {
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          stream([
            chatEvent('text.delta', 1, { text: 'Two pages lost most of it.' }),
            chatEvent('next_moves', 2, { moves: [FEATURES] }),
            ...finished.slice(1).map((e) => ({ ...e, seq: 3 })),
          ]),
          { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
        );
      });
      await render();
      await type('Why did citations fall?');
      await enter();
      expect(cards()).toEqual(['Do the same for /features']);
    });

    it('shows none in a teammate’s shared chat', async () => {
      await render({ thread: threadOf(false), variant: 'dock' });
      expect(container.querySelector('[data-slot="next-moves"]')).toBeNull();
    });
  });

  it('keeps the steer’s text, and sends nothing, when the Stop isn’t taken', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [] },
        },
      ],
    } as unknown as ChatThread;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/stop')) return Response.json({ ok: false }, { status: 500 });
      return new Response(new ReadableStream({ start: () => {} }), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await type('only blog pages');
    await enter();
    expect(calls.some((c) => c.url === `/api/chat/runs/${RUN}/stop`)).toBe(true);
    expect(calls.some((c) => c.url === '/api/chat/runs')).toBe(false);
    expect(box().value).toBe('only blog pages');
    expect(toast.error).toHaveBeenCalledWith("Couldn't send that. Try again.");
  });

  it('says the Admin, not the plan, closed Full auto for this person', async () => {
    await render({ fullAutoOpen: false, fullAutoOffByAdmin: true });
    await act(async () =>
      container.querySelector<HTMLElement>('[data-action="composer.openMode"]')!.click(),
    );
    // The mode's menu opens in a portal, outside the chat.
    const fullAuto = [...document.querySelectorAll('[role="menuitemradio"]')].find((el) =>
      el.textContent?.startsWith('Full auto'),
    )!;
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    expect(fullAuto.textContent).toContain('Off by Admin');
    expect(fullAuto.textContent).not.toContain('Needs Growth');
    expect(fullAuto.getAttribute('title')).toBe(
      'Full auto · Your Admin turned it off for your role in Settings › Chat',
    );
  });

  it('only reads a teammate’s shared chat', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Their chat',
      brandId: null,
      mine: false,
      messages: [],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).toContain(
      'A teammate shared this chat with you: you can read it, not add to it.',
    );
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/dashboard/chat');
  });

  it('pauses at the AI limit: the composer is off and says why', async () => {
    aiUsage.usage = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      unlimited: false,
      percentUsed: 100,
      features: [],
      chatMetered: true,
    };
    await render();
    expect(box().disabled).toBe(true);
    expect(box().placeholder).toBe('AI limit reached · models on your own key still work');
    expect(container.textContent).toContain("You've used this month's AI limit.");

    aiUsage.usage = { ...aiUsage.usage, trial: true };
    await render();
    expect(box().placeholder).toBe('Your trial AI limit is used up');
  });

  it('keeps the composer on at the limit when Chat runs on the workspace’s own key', async () => {
    aiUsage.usage = {
      plan: 'enterprise',
      planName: 'Enterprise',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      unlimited: false,
      percentUsed: 100,
      features: [],
      chatMetered: true,
    };
    await render({ onOwnKey: true });
    expect(box().disabled).toBe(false);
    expect(box().placeholder).not.toBe('AI limit reached · models on your own key still work');
  });

  it('reads the AI usage again once a run stops working, not before', async () => {
    await render();
    expect(aiUsage.refresh).not.toHaveBeenCalled();
    await type('What changed this week?');
    await enter();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(aiUsage.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('ChatThreadView in the Content Editor’s Chat (W4-16)', () => {
  it('says the page’s ghost text, and hands on the suggestions a run left in the page', async () => {
    const onSuggestions = vi.fn();
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('text.delta', 1, { text: 'Two suggestions wait in the page.' }),
          chatEvent('suggestion.created', 2, { count: 2 }),
          ...finished.slice(1).map((e) => ({ ...e, seq: 3 })),
        ]),
        { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
      );
    });
    await render({
      variant: 'panel',
      placeholder: 'Make the intro shorter',
      onSuggestions,
      pageRoute: '/dashboard/content/editor/d1',
    });
    expect(box().getAttribute('placeholder')).toBe('Make the intro shorter');
    await type('Make answer 3 shorter');
    await enter();
    expect(onSuggestions).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe('ChatThreadView beside a page open in the editor (Open here, W4-15c)', () => {
  const DRAFT = 'aaaaaaaa-1111-4111-8111-111111111111';
  const chip = { key: 'draft', label: 'Page: Pricing FAQ', value: DRAFT };
  const removeChip = vi.fn();
  const suggested = vi.fn();
  const ownThread = {
    conversationId: CHAT,
    title: 'Pricing FAQ',
    brandId: null,
    mine: true,
    messages: [],
  } as unknown as ChatThread;

  async function renderBeside(page: { chip: typeof chip | null } | null) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <RoleProvider role="admin">
            <PageChipContext.Provider value={page && { ...page, removeChip, suggested }}>
              <ChatThreadView
                thread={ownThread}
                variant="dock"
                defaultMode="ask_first"
                fullAutoOpen={false}
              />
            </PageChipContext.Provider>
          </RoleProvider>
        </NextIntlClientProvider>,
      );
    });
  }
  const shownChips = () =>
    [...container.querySelectorAll('[data-action="composer.removeChip"]')].map((x) =>
      x.parentElement!.firstChild!.textContent!.trim(),
    );

  beforeEach(() => {
    removeChip.mockReset();
    suggested.mockReset();
    window.history.replaceState(null, '', `/dashboard/chat/${CHAT}?page=${DRAFT}`);
  });

  it('carries the page as a chip: a request goes to the editor’s bridge for that draft, and its suggestions to the editor', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('text.delta', 1, { text: 'Two suggestions wait in the page.' }),
          chatEvent('suggestion.created', 2, { count: 2 }),
          ...finished.slice(1).map((e) => ({ ...e, seq: 3 })),
        ]),
        { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
      );
    });
    await renderBeside({ chip });
    expect(shownChips()).toEqual(['Page: Pricing FAQ']);

    await type('Make answer 3 shorter');
    await enter();
    const sent = JSON.parse(
      String(calls.find((c) => c.url === '/api/chat/runs')!.init!.body),
    ) as Record<string, unknown>;
    // As the Content Editor's Chat sends "This draft" (W4-14): from the draft's editor, by its id.
    expect(sent).toMatchObject({
      message: 'Make answer 3 shorter',
      conversationId: CHAT,
      context: { route: `/dashboard/content/editor/${DRAFT}`, chips: [chip] },
    });
    expect(sent.origin).toBeUndefined();
    expect(suggested).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('takes the chip out with ×, and sends nothing about the page without it', async () => {
    await renderBeside({ chip });
    await act(async () =>
      container.querySelector<HTMLElement>('[data-action="composer.removeChip"]')!.click(),
    );
    expect(removeChip).toHaveBeenCalledTimes(1);

    // The shell's chip gone (× or Close): the box has none, and a message no page context.
    await renderBeside({ chip: null });
    expect(shownChips()).toEqual([]);
    await type('What changed this week?');
    await enter();
    const sent = JSON.parse(
      String(calls.find((c) => c.url === '/api/chat/runs')!.init!.body),
    ) as Record<string, unknown>;
    expect(sent.context).toBeUndefined();
  });
});

describe('ChatThreadView: images (W4-08b, CHAT-15 items 18 and 22)', () => {
  const imagesThread = (steps: object[], mine = true) =>
    ({
      conversationId: CHAT,
      title: 'Cover',
      brandId: null,
      mine,
      messages: [
        { role: 'user', text: 'Create a cover', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: 'Here are four covers.',
          generatedAt: '2026-11-05T09:14:00.000Z',
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'done',
            steps,
            fileId: null,
            deliverables: [
              {
                title: 'Cover image · GEO',
                type: 'image',
                formats: ['jpg'],
                status: 'draft',
                filed: 'in_files',
              },
            ],
          },
        },
      ],
    }) as unknown as ChatThread;
  const PICKED = [
    {
      n: 1,
      kind: 'ask',
      status: 'done',
      label: 'Which image model should I use?',
      detail: 'Nano Banana 2 Lite',
    },
    {
      n: 2,
      kind: 'write',
      status: 'done',
      label: 'Created images',
      detail: '4 images · Nano Banana 2 Lite · about 0.6% of your monthly AI limit',
    },
  ];
  const model = () => container.querySelector('[data-action="model.openMenu"]')!.textContent;
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  beforeEach(() => {
    // The set's own route: four images, the person's own chat.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url.endsWith('/images')
        ? new Response(JSON.stringify({ ok: true, count: 4, selected: 1, mine: true }))
        : runApi(url, init),
    );
  });

  it('names the image model on the model button after an image request', async () => {
    await render({ thread: imagesThread(PICKED), variant: 'dock' });
    expect(model()).toBe('Image · Nano Banana 2 Lite ▾');
  });

  it('names the chat model when the latest answer wasn’t for images', async () => {
    await render({ thread: imagesThread([]), variant: 'dock' });
    expect(model()).toBe('Auto · Haiku reads, Sonnet writes ▾');
  });

  it('puts a request for new images with the same model in the box on Try again', async () => {
    await render({ thread: imagesThread(PICKED), variant: 'dock' });
    await settle();
    await act(async () =>
      container.querySelector<HTMLElement>('[data-action="deliverable.tryAgain"]')!.click(),
    );
    expect(box().value).toBe('Try again: make 4 new images with Nano Banana 2 Lite. ');
    // Nothing is sent: the person adds a change, then sends.
    expect(calls.some((c) => c.url === '/api/chat/runs')).toBe(false);
    await type('Try again: make 4 new images with Nano Banana 2 Lite. Make it blue.');
    await enter();
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body)).message).toBe(
      'Try again: make 4 new images with Nano Banana 2 Lite. Make it blue.',
    );
  });

  it('offers no Try again on a teammate’s shared chat', async () => {
    await render({ thread: imagesThread(PICKED, false), variant: 'dock' });
    await settle();
    expect(container.querySelector('[data-slot="image-set"]')).not.toBeNull();
    expect(container.querySelector('[data-action="deliverable.tryAgain"]')).toBeNull();
  });
});
