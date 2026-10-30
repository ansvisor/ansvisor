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
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (s: { activeBrandId: string }) => unknown) =>
    selector({ activeBrandId: '22222222-2222-4222-8222-222222222222' }),
}));
const aiUsage = vi.hoisted(() => ({ usage: null as Record<string, unknown> | null }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: aiUsage.usage, refresh: () => {} }),
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
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  if (url === '/api/chat/runs') {
    return new Response(stream(finished), {
      status: 200,
      headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
    });
  }
  return new Response('{}', { status: 200 });
});

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
  calls = [];
  fetchMock.mockClear();
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
});
