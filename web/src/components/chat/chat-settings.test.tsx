import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { FocusArea, HomeView } from '@/lib/chat/focus';
import type { ChatGeneralAccess, ChatGeneralSettings } from '@/lib/chat/general-settings';

/**
 * Chat Settings › General (mockup #s-settings): each pick shows at once and
 * is kept on the person; one that isn't kept goes back and says so. Full
 * auto says why it's locked and can't be picked; a reader picks no mode.
 * Answer language, notifications and "Thought for N s" stay hidden until
 * something reads them.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));
const toasts = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('sonner', () => {
  const toast = (text: string) => toasts.calls.push(text);
  toast.error = (text: string) => toasts.calls.push(`error: ${text}`);
  return { toast };
});
const saved = vi.hoisted(() => ({
  ok: true,
  patches: [] as unknown[],
  focus: [] as unknown[],
  defaults: 0,
}));
// The product tour's server actions (00486): their own tests.
vi.mock('@/lib/actions/chat-tour', () => ({
  showTourTopic: vi.fn(async () => ({ ok: false })),
  endChatTour: vi.fn(async () => ({ ok: false })),
  prepareChatTour: vi.fn(async () => undefined),
}));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatGeneralSettings: vi.fn(async (patch: unknown) => {
    saved.patches.push(patch);
    return { ok: saved.ok };
  }),
  saveChatFocus: vi.fn(async (areas: unknown) => {
    saved.focus.push(areas);
    return { ok: saved.ok };
  }),
  saveDefaultHome: vi.fn(async () => {
    saved.defaults += 1;
    return { ok: saved.ok };
  }),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const { ChatSettings } = await import('./chat-settings');
const { ChatTourProvider } = await import('./tour/chat-tour');
const { ChatPanelContext } = await import('./panel/chat-panel-context');
const tourActions = await import('@/lib/actions/chat-tour');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SETTINGS: ChatGeneralSettings = {
  defaultMode: 'auto',
  answerLanguage: null,
  notifyVia: 'inbox_email',
  showThought: true,
  panelOnPages: true,
  pageOpen: 'ask',
};
const OPEN: ChatGeneralAccess = { modes: true, fullAutoLock: null, slack: false };

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  saved.ok = true;
  saved.patches = [];
  saved.focus = [];
  saved.defaults = 0;
  toasts.calls = [];
  router.refresh.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(
  settings = SETTINGS,
  access = OPEN,
  focus: FocusArea[] = [],
  view: HomeView = focus.length ? 'focus' : 'default',
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatSettings initial={settings} access={access} focus={focus} view={view} />
      </NextIntlClientProvider>,
    );
  });
}

const action = (name: string) => host.querySelectorAll<HTMLElement>(`[data-action="${name}"]`);
const modes = () => [...action('chatSettings.defaultMode')];

describe('ChatSettings', () => {
  it("shows the General settings as the mockup does, with the person's choices", async () => {
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Settings');
    expect(host.querySelector('h2')?.textContent).toBe('General');
    expect(modes().map((m) => m.textContent)).toEqual([
      'Ask me first',
      'Auto, ask before changes',
      'Full auto',
    ]);
    expect(modes()[1].getAttribute('aria-checked')).toBe('true');
    expect(action('chatSettings.toggleAskChatEverywhere')[0].getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(action('policy.open')[0].getAttribute('href')).toBe('/dashboard/settings/chat');
  });

  it('shows "Thought for N s" as a switch, on by default, and keeps a change at once', async () => {
    await render();
    const toggle = () => action('chatSettings.toggleThinking')[0];
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Show “Thought for N s”');
    await act(async () => toggle().click());
    expect(saved.patches).toEqual([{ showThought: false }]);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('offers how to hear that an agent needs you, Slack only once it connects, and keeps a pick', async () => {
    await render();
    const select = action('chatSettings.notifyChannel')[0] as HTMLSelectElement;
    expect([...select.options].map((option) => [option.textContent, option.disabled])).toEqual([
      ['Inbox + email', false],
      ['Inbox only', false],
      ['Inbox + Slack (connect Slack first)', true],
    ]);
    expect(select.value).toBe('inbox_email');
    await act(async () => {
      select.value = 'inbox';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saved.patches).toEqual([{ notifyVia: 'inbox' }]);
  });

  it('offers the answer languages Chat reads, "Same as my question" first, and keeps a pick at once', async () => {
    await render();
    const select = action('chatSettings.answerLanguage')[0] as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Same as my question',
      'English',
      'Türkçe',
      'Deutsch',
      'Français',
      'Español',
      'Italiano',
      'Português',
      'Nederlands',
    ]);
    expect(select.value).toBe('');
    await act(async () => {
      select.value = 'tr';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saved.patches).toEqual([{ answerLanguage: 'tr' }, { answerLanguage: null }]);
  });

  it('keeps where pages open: ask, in chat or the Content Editor, no Open here yet (W4-11)', async () => {
    await render();
    const choices = [...action('chatSettings.pageOpen')];
    expect(choices.map((el) => el.textContent)).toEqual([
      'Ask each time',
      'Keep in chat',
      'Content Editor',
    ]);
    expect(choices[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => choices[2].click());
    expect(saved.patches).toEqual([{ pageOpen: 'editor' }]);
    expect(action('chatSettings.pageOpen')[2].getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Where pages open');
  });

  it('keeps each pick at once', async () => {
    await render();
    await act(async () => modes()[0].click());
    expect(modes()[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => action('chatSettings.toggleAskChatEverywhere')[0].click());
    expect(saved.patches).toEqual([{ defaultMode: 'ask_first' }, { panelOnPages: false }]);
    expect(action('chatSettings.toggleAskChatEverywhere')[0].getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(toasts.calls).toEqual([]);
    // Ask Chat on every page: the layout reads it again, so every page follows.
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("puts a pick back when it wasn't kept, and says so", async () => {
    saved.ok = false;
    await render();
    await act(async () => action('chatSettings.toggleAskChatEverywhere')[0].click());
    expect(action('chatSettings.toggleAskChatEverywhere')[0].getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(toasts.calls).toEqual(["error: Couldn't save that. Try again."]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('says why Full auto is locked and keeps it from being picked', async () => {
    await render(SETTINGS, { ...OPEN, fullAutoLock: 'plan' });
    const fullAuto = modes()[2];
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    expect(fullAuto.getAttribute('title')).toBe('Full auto needs the Growth plan');
    await act(async () => fullAuto.click());
    expect(saved.patches).toEqual([]);
  });

  it('gives a role that only reads no default mode', async () => {
    await render(SETTINGS, { ...OPEN, modes: false });
    expect(modes()).toHaveLength(0);
    expect(action('chatSettings.toggleAskChatEverywhere')).toHaveLength(1);
  });
  it('shows the focus picked, and keeps a change at once in the order picked (CHAT-24 §3 item 2)', async () => {
    await render(SETTINGS, OPEN, ['pd']);
    const boxes = () => [...action('chatSettings.focus')] as HTMLInputElement[];
    expect(boxes().map((box) => box.parentElement?.textContent)).toEqual([
      'Big picture',
      'Competitors',
      'AI traffic',
      'Prompts and citations',
      'Content',
      'Brand',
      'Product',
      'Markets and sources',
    ]);
    expect(
      boxes()
        .filter((box) => box.checked)
        .map((box) => box.value),
    ).toEqual(['pd']);
    const plain = () => (action('chatSettings.focusDefault')[0] as HTMLInputElement).checked;
    expect(plain()).toBe(false);
    await act(async () => boxes()[0].click());
    await act(async () => boxes()[6].click());
    await act(async () => boxes()[0].click());
    expect(saved.focus).toEqual([['pd', 'lead'], ['lead'], []]);
    expect(plain()).toBe(true);
    expect(toasts.calls).toEqual([
      'Home focused on Product and Big picture',
      'Home focused on Big picture',
      'Home is on the Default view',
    ]);
  });

  it('puts Home on the Default view with its focus kept, and an area starts a new focus (00485)', async () => {
    await render(SETTINGS, OPEN, ['pd', 'comp']);
    const plain = action('chatSettings.focusDefault')[0] as HTMLInputElement;
    expect(plain.parentElement?.textContent).toBe('Default view');
    await act(async () => plain.click());
    expect(saved.defaults).toBe(1);
    expect(saved.focus).toEqual([]);
    const checked = () =>
      ([...action('chatSettings.focus')] as HTMLInputElement[])
        .filter((box) => box.checked)
        .map((box) => box.value);
    expect(plain.checked).toBe(true);
    expect(checked()).toEqual([]);
    expect(toasts.calls).toEqual(['Home is on the Default view']);
    // Already on it: nothing to keep.
    await act(async () => plain.click());
    expect(saved.defaults).toBe(1);
    const brand = [...action('chatSettings.focus')].find(
      (box) => (box as HTMLInputElement).value === 'brand',
    ) as HTMLInputElement;
    await act(async () => brand.click());
    expect(saved.focus).toEqual([['brand']]);
    expect(checked()).toEqual(['brand']);
    expect(plain.checked).toBe(false);
  });

  it('gives a role that only reads its focus too, and puts a change back that was not kept', async () => {
    saved.ok = false;
    await render(SETTINGS, { ...OPEN, modes: false }, ['brand']);
    const brand = [...action('chatSettings.focus')].find(
      (box) => (box as HTMLInputElement).value === 'brand',
    ) as HTMLInputElement;
    await act(async () => brand.click());
    expect(brand.checked).toBe(true);
    expect(toasts.calls).toEqual(["error: Couldn't save that. Try again."]);
  });
});

describe('ChatSettings › Product tour (00486)', () => {
  const openChat = vi.fn();
  async function renderWithTour(settings = SETTINGS, enabled = true) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <ChatPanelContext.Provider value={{ setup: { enabled }, openChat } as never}>
            <ChatTourProvider initial={{ chatId: 'tour-1', topic: null, finished: true }}>
              <ChatSettings initial={settings} access={OPEN} focus={[]} view="default" />
            </ChatTourProvider>
          </ChatPanelContext.Provider>
        </NextIntlClientProvider>,
      );
    });
  }

  it('takes the tour again from its first topic, beside the page', async () => {
    vi.mocked(tourActions.showTourTopic).mockResolvedValueOnce({ ok: true, chatId: 'tour-1' });
    await renderWithTour();
    const take = action('chatSettings.takeTour')[0];
    expect(take.textContent).toBe('Take the tour');
    await act(async () => take.click());
    expect(tourActions.showTourTopic).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'visibility', via: 'everything' }),
    );
    expect(router.push).toHaveBeenCalledWith('/dashboard/insights');
    expect(openChat).toHaveBeenCalledWith('tour-1');
  });

  it('offers no tour where Chat isn’t on pages for the person', async () => {
    await renderWithTour({ ...SETTINGS, panelOnPages: false });
    expect(action('chatSettings.takeTour')).toHaveLength(0);
    await renderWithTour(SETTINGS, false);
    expect(action('chatSettings.takeTour')).toHaveLength(0);
    // Without the dashboard's tour (a test, the Chat flag off): none either.
    await render();
    expect(action('chatSettings.takeTour')).toHaveLength(0);
  });
});
