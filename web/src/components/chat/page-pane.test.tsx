import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import {
  UpgradeDialogContext,
  useUpgradeGate,
  type UpgradeDialogState,
} from '@/components/providers/upgrade-gate';

/**
 * Open here's split layout (CHAT-25 §4, W4-15a): a chat whose address
 * names a page (`?page={draftId}`) has the editor beside it, the chat about
 * 420px (at least 300px) on the left; Close takes `?page` out; with no room
 * for 300px of chat and a 600px editor, one at a time, with Back to chat and
 * a way back to the page, neither unmounted; Chat's side panel never sits
 * beside it; Analysts and Agency partners get the page read-only, and what
 * they click asks their Admin.
 */

const nav = vi.hoisted(() => ({ pathname: '/dashboard/chat', push: vi.fn() }));
const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/agentic/runs-tray', () => ({
  RunsTray: () => <button type="button" data-action="runs.toggleTray" />,
}));
vi.mock('@/lib/actions/chat-schedules', () => ({ countChatSchedules: vi.fn(async () => 0) }));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatMenuOpen: vi.fn(async () => ({ ok: true })),
  saveChatPanelSize: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/actions/chat-tour', () => ({ endChatTour: vi.fn(), showTourTopic: vi.fn() }));
const requestAccess = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: null, refresh: () => undefined }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// Chat's side panel, as its slot loads it the first time it opens.
vi.mock('./panel/chat-side-panel', () => ({
  ChatSidePanel: () => <aside data-testid="side-panel" />,
}));

/**
 * The editor surface PagePane loads on demand (next/dynamic): a stand-in
 * that shows what it was given and gates Mark ready as the editor does.
 */
interface SurfaceProps {
  draftId: string;
  embedded?: boolean;
  onClose?: () => void;
}
const surface = vi.hoisted(() => ({
  Component: null as ((props: SurfaceProps) => ReactNode) | null,
  loading: null as (() => ReactNode) | null,
  marked: vi.fn(),
}));
vi.mock('next/dynamic', () => ({
  default: (_load: unknown, options: { loading: () => ReactNode }) => {
    surface.loading = options.loading;
    return function Loaded(props: SurfaceProps) {
      const Surface = surface.Component!;
      return <Surface {...props} />;
    };
  },
}));
function FakeSurface({ draftId, embedded, onClose }: SurfaceProps) {
  const { isLocked, guard } = useUpgradeGate();
  return (
    <div
      data-testid="surface"
      data-draft={draftId}
      data-embedded={String(embedded)}
      data-locked={String(isLocked)}
    >
      <button type="button" data-action="editor.close" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        data-action="editor.markReady"
        onClick={guard(() => surface.marked(), { action: 'Marking a page ready needs a plan' })}
      >
        Mark ready
      </button>
    </div>
  );
}
surface.Component = FakeSurface;

const { PagePane } = await import('./page-pane');
const { ChatShell } = await import('./chat-shell');
const { ChatPanelProvider } = await import('./panel/chat-panel-provider');
const { ChatSidePanelSlot } = await import('./panel/chat-side-panel-slot');
const { useChatPanel } = await import('./panel/chat-panel-context');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = 'cccccccc-0000-4000-8000-000000000001';
const DRAFT = 'dddddddd-0000-4000-8000-000000000001';
const OTHER = 'dddddddd-0000-4000-8000-000000000002';

/** The shell's frame width, as its ResizeObserver reports it; `resize` reports a new one. */
let width = 1440;
const reports = new Set<() => void>();
async function resize(next: number) {
  width = next;
  await act(async () => reports.forEach((report) => report()));
}

let root: Root;
let host: HTMLDivElement;
let outer: UpgradeDialogState;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.pathname = `/dashboard/chat/${CHAT}`;
  search.value = `page=${DRAFT}`;
  width = 1440;
  surface.marked.mockClear();
  requestAccess.mockClear();
  outer = { isLocked: false, reason: 'ended', adminName: null, openUpgrade: vi.fn() };
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private report: (() => void) | null = null;
      constructor(private callback: ResizeObserverCallback) {}
      observe(el: Element) {
        this.report = () =>
          this.callback(
            [
              {
                target: el,
                contentRect: { width },
                borderBoxSize: [{ inlineSize: width, blockSize: 800 }],
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        reports.add(this.report);
        this.report();
      }
      unobserve() {}
      disconnect() {
        if (this.report) reports.delete(this.report);
      }
    },
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  reports.clear();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode, role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <UpgradeDialogContext.Provider value={outer}>{node}</UpgradeDialogContext.Provider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const one = (selector: string) => host.querySelector<HTMLElement>(selector);
const action = (name: string) => one(`[data-action="${name}"]`);
const pane = () => one('[data-slot="page-pane"]');
const column = () => one('[data-slot="chat-column"]')!;
const click = (el: HTMLElement | null) => act(async () => el!.click());

describe('PagePane', () => {
  it('shows the page in the editor, embedded, with its Close', async () => {
    const onClose = vi.fn();
    await render(<PagePane draftId={DRAFT} onClose={onClose} />);
    const editor = one('[data-testid="surface"]')!;
    expect(editor.dataset.draft).toBe(DRAFT);
    expect(editor.dataset.embedded).toBe('true');
    expect(editor.dataset.locked).toBe('false');
    expect(pane()?.getAttribute('aria-label')).toBe('Page beside the chat');
    // Side by side: no Back to chat, nothing read-only.
    expect(action('pagePane.backToChat')).toBeNull();
    expect(one('[data-slot="page-pane-read-only"]')).toBeNull();
    await click(action('editor.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives Back to chat when one shows at a time', async () => {
    const onBack = vi.fn();
    await render(<PagePane draftId={DRAFT} onClose={vi.fn()} onBackToChat={onBack} />);
    const back = action('pagePane.backToChat')!;
    expect(back.textContent).toBe('← Back to chat');
    expect(back.getAttribute('title')).toBe('Show the chat. The page stays open.');
    await click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows a quiet outline of the editor while the editor's code loads", async () => {
    const Loading = surface.loading!;
    await render(<Loading />);
    const outline = one('[data-slot="page-pane-loading"]')!;
    expect(outline.getAttribute('aria-busy')).toBe('true');
    expect(outline.querySelector('.sr-only')?.textContent).toBe('Opening the page…');
    expect(outline.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });

  it.each([
    ['analyst', 'Analyst'],
    ['agency_partner', 'Agency partner'],
  ] as const)(
    'opens the page read-only for an %s, and Mark ready asks their Admin',
    async (role, name) => {
      await render(<PagePane draftId={DRAFT} onClose={vi.fn()} />, role);
      expect(one('[data-slot="page-pane-read-only"]')?.textContent).toBe(
        `Read only: your role is ${name}. Admins and Managers can change this page.Ask your Admin`,
      );
      // The editor's own read-only mode: nothing types, saves or runs.
      expect(one('[data-testid="surface"]')?.dataset.locked).toBe('true');
      await click(action('editor.markReady'));
      expect(surface.marked).not.toHaveBeenCalled();
      // Ask your Admin, not the plans.
      expect(outer.openUpgrade).not.toHaveBeenCalled();
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Ask your Admin');
      expect(dialog.querySelector('textarea')?.value).toBe(
        'Change my role so I can make changes in this workspace',
      );
      expect(dialog.textContent).toContain(`Your role is ${name}.`);
      const send = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Send')!;
      await act(async () => send.click());
      expect(requestAccess).toHaveBeenCalledWith({
        asked: 'Change my role so I can make changes in this workspace',
        ruleKind: 'role',
        ruleDetail: `Your role is ${name}.`,
        toolKey: null,
      });
    },
  );

  it('lets Admins and Managers change the page, and keeps the plans first in a read-only workspace', async () => {
    await render(<PagePane draftId={DRAFT} onClose={vi.fn()} />, 'manager');
    expect(one('[data-testid="surface"]')?.dataset.locked).toBe('false');
    expect(one('[data-slot="page-pane-read-only"]')).toBeNull();
    await click(action('editor.markReady'));
    expect(surface.marked).toHaveBeenCalledTimes(1);

    // No plan: an Analyst gets the workspace's own dialog, as on every page.
    outer = { ...outer, isLocked: true };
    await render(<PagePane draftId={DRAFT} onClose={vi.fn()} />, 'analyst');
    expect(one('[data-testid="surface"]')?.dataset.locked).toBe('true');
    await click(action('editor.markReady'));
    expect(outer.openUpgrade).toHaveBeenCalledWith('Marking a page ready needs a plan');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('ChatShell with a page open (?page=)', () => {
  const shell = (children: ReactNode = <p>chat</p>) => <ChatShell menuOpen>{children}</ChatShell>;

  it('puts the chat on the left at about 420px, never under 300px, and the editor on the right', async () => {
    await render(shell());
    const chat = column();
    expect(chat.className).toContain('w-[420px]');
    expect(chat.className).toContain('min-w-[300px]');
    expect(chat.className).not.toContain('flex-1');
    expect(chat.textContent).toContain('chat');
    const page = pane()!;
    expect(page.className).toContain('flex-1');
    expect(page.className).toContain('min-w-[600px]');
    // The chat first, the page after it: the page on the right.
    expect(chat.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(one('[data-testid="surface"]')?.dataset.draft).toBe(DRAFT);
    // Both shown: no Back to chat, no way back to the page needed.
    expect(action('pagePane.backToChat')).toBeNull();
    expect(action('pagePane.showPage')).toBeNull();
    expect(chat.hasAttribute('inert')).toBe(false);
  });

  it("opens nothing for an id that isn't a draft's, or off a chat's page", async () => {
    search.value = 'page=nope';
    await render(shell());
    expect(pane()).toBeNull();
    expect(column().className).toContain('flex-1');

    search.value = `page=${DRAFT}`;
    nav.pathname = '/dashboard/chat';
    await render(shell());
    expect(pane()).toBeNull();
    nav.pathname = '/dashboard/chat/all';
    await render(shell());
    expect(pane()).toBeNull();
  });

  it('closes the page by taking ?page out of the address, and the chat takes the width', async () => {
    window.history.replaceState(
      null,
      '',
      `/dashboard/chat/${CHAT}?from=%2Fdashboard%2Fmentions&page=${DRAFT}`,
    );
    search.value = `from=%2Fdashboard%2Fmentions&page=${DRAFT}`;
    const replace = vi.spyOn(window.history, 'replaceState');
    await render(shell());
    await click(action('editor.close'));
    expect(replace).toHaveBeenCalledWith(
      null,
      '',
      `/dashboard/chat/${CHAT}?from=%2Fdashboard%2Fmentions`,
    );
    expect(window.location.search).toBe('?from=%2Fdashboard%2Fmentions');
    replace.mockRestore();
    // The address read again (Next keeps useSearchParams in step with it).
    search.value = 'from=%2Fdashboard%2Fmentions';
    await render(shell());
    expect(pane()).toBeNull();
    expect(column().className).toContain('flex-1');
    expect(column().className).not.toContain('w-[420px]');
  });

  it('with no room for both, shows the page full width; Back to chat shows the chat and keeps the page', async () => {
    // 1100px less the chat menu's 256px: 844px, under 300 + 600.
    width = 1100;
    await render(shell());
    const editor = one('[data-testid="surface"]')!;
    let page = pane()!;
    expect(page.className).not.toContain('invisible');
    expect(page.className).not.toContain('min-w-[600px]');
    expect(page.hasAttribute('inert')).toBe(false);
    // The chat is still there, unseen, at the page's width: its run and scroll go on.
    expect(column().className).toContain('invisible');
    expect(column().hasAttribute('inert')).toBe(true);
    expect(column().style.width).toBe('844px');

    await click(action('pagePane.backToChat'));
    expect(column().className).not.toContain('invisible');
    expect(column().className).toContain('flex-1');
    expect(column().hasAttribute('inert')).toBe(false);
    page = pane()!;
    expect(page.className).toContain('invisible');
    expect(page.hasAttribute('inert')).toBe(true);
    // The same editor, not opened again: its edits stay.
    expect(one('[data-testid="surface"]')).toBe(editor);

    // From the chat, the header leads back to the page.
    const back = action('pagePane.showPage')!;
    expect(back.textContent).toBe('Back to the page →');
    expect(back.getAttribute('title')).toBe('Show the page open beside this chat');
    await click(back);
    expect(pane()!.className).not.toContain('invisible');
    expect(column().className).toContain('invisible');
    expect(action('pagePane.showPage')).toBeNull();
    expect(one('[data-testid="surface"]')).toBe(editor);
  });

  it('goes side by side again once there is room: a wider window, or the menu hidden', async () => {
    width = 1100;
    await render(shell());
    expect(action('pagePane.backToChat')).not.toBeNull();
    await resize(1440);
    expect(action('pagePane.backToChat')).toBeNull();
    expect(column().className).toContain('w-[420px]');
    await resize(1100);
    expect(action('pagePane.backToChat')).not.toBeNull();
    // Ctrl+\ hides the menu: its 256px go to the chat and the page.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    });
    expect(action('pagePane.backToChat')).toBeNull();
    expect(pane()!.className).toContain('min-w-[600px]');
  });

  it("is the one pane on the right: Chat's side panel stays off, and a new page takes the old one's place", async () => {
    function OpenPanel() {
      const panel = useChatPanel();
      return (
        <button type="button" data-action="test.openPanel" onClick={() => panel?.openChat(CHAT)}>
          {String(panel?.open)}
        </button>
      );
    }
    const setup = {
      enabled: true,
      size: 'compact',
      firstName: null,
      defaultMode: 'ask_first',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      onOwnKey: false,
      keyFailure: null,
      usageNoticeSeen: null,
      skills: [],
    } as const;
    const app = () => (
      <ChatPanelProvider setup={{ ...setup, skills: [] }}>
        {shell(<OpenPanel />)}
        <ChatSidePanelSlot />
      </ChatPanelProvider>
    );
    width = 1100;
    await render(app());
    // Ctrl J on Chat's routes goes to the composer, and nothing opens the panel there.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }));
    });
    await click(action('pagePane.backToChat'));
    await click(action('test.openPanel'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(action('test.openPanel')?.textContent).toBe('false');
    expect(host.querySelector('[data-testid="side-panel"]')).toBeNull();
    expect(host.querySelectorAll('[data-slot="page-pane"]')).toHaveLength(1);

    // Another page: it takes the pane, and shows itself.
    search.value = `page=${OTHER}`;
    await render(app());
    expect(host.querySelectorAll('[data-slot="page-pane"]')).toHaveLength(1);
    expect(one('[data-testid="surface"]')?.dataset.draft).toBe(OTHER);
    expect(pane()!.className).not.toContain('invisible');
    expect(column().className).toContain('invisible');
  });
});
