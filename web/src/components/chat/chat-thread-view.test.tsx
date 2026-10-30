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
 * stops the run first, and a teammate's shared chat is read only.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const gate = vi.hoisted(() => ({ isLocked: false, openUpgrade: vi.fn() }));
vi.mock('@/components/providers/upgrade-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/providers/upgrade-gate')>()),
  useUpgradeGate: () => gate,
}));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));
vi.mock('@/lib/actions/chat-references', () => ({
  searchChatReferences: vi.fn(async () => ({ ok: true, references: [] })),
}));
vi.mock('@/lib/chat/upload-client', () => ({ uploadChatFile: vi.fn(), dropChatUpload: vi.fn() }));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveUsageNoticePeriod: vi.fn(async () => ({ ok: true })),
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
async function answerFetch(url: string, init?: RequestInit) {
  calls.push({ url, init });
  if (url === '/api/chat/runs') {
    return new Response(stream(finished), {
      status: 200,
      headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
    });
  }
  return new Response('{}', { status: 200 });
}
const fetchMock = vi.fn(answerFetch);

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

beforeEach(() => {
  aiUsage.usage = null;
  aiUsage.refresh.mockClear();
  calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(answerFetch);
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
    expect(container.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe(
      'Ask me first',
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

  it('puts Copy, Download and Save to Files under a finished answer, In Files once filed', async () => {
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
          run: { runId: RUN, status: 'done', steps: [], fileId: 'f1' },
        },
      ],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    const bar = container.querySelector('[role="toolbar"][aria-label="Answer actions"]')!;
    expect(
      [...bar.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Copy', 'Download', 'In Files']);
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
    const fullAuto = [...container.querySelectorAll('[role="radio"]')].find((el) =>
      el.textContent?.startsWith('Full auto'),
    )!;
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    expect(fullAuto.textContent).toContain('Off by Admin');
    expect(fullAuto.textContent).not.toContain('Needs Growth');
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
