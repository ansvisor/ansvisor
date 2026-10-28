import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { DemoBrandContext } from '@/components/providers/demo-brand-provider';

/**
 * Chat on a read-only workspace (plan not active): New chat, sending and
 * deleting a conversation open the upgrade dialog, named, and send nothing.
 * The conversations still list and open.
 */

const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  stop: vi.fn(),
  clearError: vi.fn(),
}));
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({ messages: [], status: 'ready', error: undefined, ...chat }),
}));
vi.mock('ai', () => ({ DefaultChatTransport: class {} }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, requiredPlanFor: () => 'Starter', isCloud: false }),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) => select({ activeBrandId: 'b1' }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AgentPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const fetchMock = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/agent/conversations'
      ? json({
          conversations: [
            {
              id: 'c1',
              title: 'Pricing questions',
              brand_id: 'b1',
              created_at: '2026-10-27',
              updated_at: '2026-10-27',
            },
          ],
        })
      : json({ messages: [] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

async function render(isLocked: boolean, isDemo = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DemoBrandContext.Provider
          value={{ isDemo, demoBrand: null, offer: 'trial', neverSubscribed: true }}
        >
          <UpgradeDialogContext.Provider
            value={{
              isLocked,
              isDemo,
              reason: isDemo ? 'demo' : 'ended',
              adminName: null,
              openUpgrade,
            }}
          >
            <AgentPage />
          </UpgradeDialogContext.Provider>
        </DemoBrandContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const remove = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Delete conversation"]')!;
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method);

async function send(text: string) {
  const input = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('Chat on a read-only workspace', () => {
  it('starts, sends and deletes nothing: each opens the upgrade dialog', async () => {
    await render(true);
    expect(container.textContent).toContain('Pricing questions');

    await act(async () => button('New chat').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Starting a chat needs a plan');
    await send('How do we rank?');
    expect(openUpgrade).toHaveBeenLastCalledWith('Chatting with the agent needs a plan');
    await act(async () => remove().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Deleting chats needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('asks before deleting a conversation on an active plan', async () => {
    await render(false);
    await act(async () => remove().click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Delete conversation');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

describe('Chat on the demo brand', () => {
  it('shows the Chat v2 preview, next week, and reads or sends nothing', async () => {
    await render(true, true);
    expect(container.textContent).toContain('Soon (next week)');
    expect(container.textContent).toContain('Chat arrives next week. This is a preview of it.');
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('/demo/chat/CHAT-mockup-v2.html#s-home');
    expect(frame.getAttribute('title')).toBe('Chat preview');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(container.querySelector('textarea')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
