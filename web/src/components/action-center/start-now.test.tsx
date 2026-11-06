import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { ChatPanelContext, type ChatPanelState } from '@/components/chat/panel/chat-panel-context';
import type { ActionDraft, StartNowWork } from '@/lib/content/action-drafts';

/**
 * Start now (AC-ACTION-PLAN spec §10, P-3): the drawer's block opens the
 * action's draft in the Content Editor (one per page of a multi-page
 * play, then the Library on the action's drafts), its brief built as it
 * opens; Chat shows Soon until the new Chat is on (K11), then runs Chat on
 * the action beside it; a read-only workspace or the demo brand gets the
 * plan dialog.
 */

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard/action-center/actions',
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
const server = vi.hoisted(() => ({ startDraftFromAction: vi.fn() }));
vi.mock('@/lib/actions/content-drafts', () => server);
const chat = vi.hoisted(() => ({ runChatOnAction: vi.fn() }));
vi.mock('@/components/chat/agents/agent-requests', () => chat);

const { StartNowBlock } = await import('./start-now');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = 'b1';
const ACTION = { id: 'a1', actionNo: 2841, title: 'Write a page for boots' };
const PAGES = ['https://shop.example/boots', 'https://shop.example/socks'];

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const openChat = vi.fn();

async function render({
  work = { taskId: 't1', method: 'create', pages: [] } as StartNowWork,
  drafts = [] as ActionDraft[],
  chatOn = false,
  role = 'manager' as TeamRole,
  locked = false,
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <ChatAgenticProvider enabled={chatOn}>
            <UpgradeDialogContext.Provider
              value={{ isLocked: locked, reason: 'ended', adminName: null, openUpgrade }}
            >
              <ChatPanelContext.Provider
                value={{ available: true, openChat } as unknown as ChatPanelState}
              >
                <StartNowBlock brandId={BRAND} action={ACTION} work={work} drafts={drafts} />
              </ChatPanelContext.Provider>
            </UpgradeDialogContext.Provider>
          </ChatAgenticProvider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: RegExp) =>
  [...container.querySelectorAll('button')].find((b) => name.test(b.textContent ?? '')) ?? null;
const click = (el: HTMLElement | null) =>
  act(async () => {
    el!.click();
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  server.startDraftFromAction.mockImplementation(async (_b, _a, _t, { page }) => ({
    draftId: page ? `d-${page.split('/').pop()}` : 'd-new',
    created: true,
    importFailed: false,
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('StartNowBlock', () => {
  it('opens a new draft in the Content Editor, its brief to build', async () => {
    await render();
    expect(container.textContent).toContain('Start now');
    expect(container.textContent).toContain('Opens a new draft with this action');
    await click(button(/^Content Editor$/));
    expect(server.startDraftFromAction).toHaveBeenCalledWith(BRAND, 'a1', 't1', {
      page: null,
      title: ACTION.title,
    });
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d-new?brief=build');
  });

  it("opens one draft per page, then the Library on the action's drafts", async () => {
    await render({
      work: { taskId: 't2', method: 'optimize', pages: PAGES },
      drafts: [{ id: 'd-had', method: 'optimize', sourceUrl: PAGES[0], status: 'draft' }],
    });
    await click(button(/Content Editor · 2 drafts/));
    // The draft already written is kept; only the other page's is written.
    expect(server.startDraftFromAction).toHaveBeenCalledTimes(1);
    expect(server.startDraftFromAction).toHaveBeenCalledWith(BRAND, 'a1', 't2', {
      page: PAGES[1],
      title: ACTION.title,
    });
    expect(push).toHaveBeenCalledWith('/dashboard/content/library?action=a1');
  });

  it('opens the draft written, as it is, once there is one', async () => {
    await render({
      work: { taskId: 't2', method: 'optimize', pages: [PAGES[0]] },
      drafts: [{ id: 'd-had', method: 'optimize', sourceUrl: PAGES[0], status: 'draft' }],
    });
    expect(container.textContent).toContain('Its draft is started');
    await click(button(/^Open draft$/));
    expect(server.startDraftFromAction).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d-had');
  });

  it('says so when the draft could not be written, and stays', async () => {
    server.startDraftFromAction.mockResolvedValue({ error: 'failed' });
    await render();
    await click(button(/^Content Editor$/));
    expect(toast.error).toHaveBeenCalledWith("Couldn't open the Content Editor. Try again.");
    expect(push).not.toHaveBeenCalled();
  });

  it('shows Chat as Soon, doing nothing, until the new Chat is on (K11)', async () => {
    await render({ chatOn: false });
    const soon = button(/Chat\s*Soon/);
    expect(soon).not.toBeNull();
    expect(soon!.disabled).toBe(true);
    await click(soon);
    expect(chat.runChatOnAction).not.toHaveBeenCalled();
  });

  it('runs Chat on the action beside it once Chat is on, for Admins and Managers', async () => {
    chat.runChatOnAction.mockResolvedValue({ ok: true, chatId: 'c1', queued: false });
    await render({ chatOn: true });
    expect(container.textContent).not.toContain('Soon');
    await click(button(/^Chat$/));
    expect(chat.runChatOnAction).toHaveBeenCalledWith('a1', expect.any(String));
    expect(openChat).toHaveBeenCalledWith('c1');
    expect(toast).toHaveBeenCalledWith('Chat is working on AC-2841');

    await render({ chatOn: true, role: 'analyst' });
    expect(button(/^Chat$/)).toBeNull();
    expect(button(/^Content Editor$/)).not.toBeNull();
  });

  it('opens the plan dialog instead on a read-only workspace or the demo brand', async () => {
    await render({ locked: true, chatOn: true });
    await click(button(/^Content Editor$/));
    await click(button(/^Chat$/));
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(server.startDraftFromAction).not.toHaveBeenCalled();
    expect(chat.runChatOnAction).not.toHaveBeenCalled();
  });
});
