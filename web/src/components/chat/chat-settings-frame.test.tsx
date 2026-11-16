import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Chat's Settings frame (owner request, 16 Nov 2026): the title, its line
 * and the page's own left navigation, General, Activity, What Chat can do
 * and Tool policy, stay on every tab; the open tab is marked, and its page
 * shows on the right. With the new Chat off there is no frame.
 */

const nav = vi.hoisted(() => ({ pathname: '/dashboard/chat/settings' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ChatSettingsFrame } = await import('./chat-settings-frame');
const { ChatAgenticProvider } = await import('@/components/providers/chat-agentic-provider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  nav.pathname = '/dashboard/chat/settings';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(pathname: string, page: ReactNode, chatOn = true) {
  nav.pathname = pathname;
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatOn}>
          <ChatSettingsFrame>{page}</ChatSettingsFrame>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const tabs = () => [
  ...host.querySelectorAll<HTMLAnchorElement>('[data-action="chatSettings.tab"]'),
];
const marked = () => tabs().filter((tab) => tab.getAttribute('aria-current') === 'page');

const PAGES = [
  ['/dashboard/chat/settings', 'General', 'general'],
  ['/dashboard/chat/activity', 'Activity', 'activity'],
  ['/dashboard/chat/capabilities', 'What Chat can do', 'capabilities'],
  ['/dashboard/chat/policy', 'Tool policy', 'policy'],
] as const;

describe('ChatSettingsFrame', () => {
  it('lists General, Activity, What Chat can do and Tool policy, in that order, with their links', async () => {
    await render('/dashboard/chat/settings', <p>general</p>);
    const navEl = host.querySelector('nav')!;
    expect(navEl.getAttribute('aria-label')).toBe('Settings');
    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual(
      PAGES.map(([href, label]) => [label, href]),
    );
    // Every tab is in the page's own navigation, each one a link, none leaving Chat.
    for (const tab of tabs()) {
      expect(navEl.contains(tab)).toBe(true);
      expect(tab.tagName).toBe('A');
      expect(tab.getAttribute('href')).toMatch(/^\/dashboard\/chat\//);
      expect(tab.getAttribute('target')).toBeNull();
    }
    expect(tabs().map((tab) => tab.dataset.tab)).toEqual(PAGES.map(([, , id]) => id));
  });

  it.each(PAGES)(
    'keeps the title, its line and the tabs on %s, with that tab marked and its page on the right',
    async (href, label) => {
      await render(href, <h2>{`${label} page`}</h2>);
      // The frame: one title, its line, the four tabs.
      expect([...host.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Settings']);
      expect(host.textContent).toContain('How Chat works for you and your team.');
      expect(tabs()).toHaveLength(4);
      // Only the open tab is marked, and it looks marked.
      expect(marked().map((tab) => tab.textContent)).toEqual([label]);
      expect(marked()[0].className.split(' ')).toContain('bg-muted');
      for (const tab of tabs().filter((tab) => tab.textContent !== label)) {
        expect(tab.className.split(' ')).not.toContain('bg-muted');
        expect(tab.className).toContain('text-muted-foreground');
      }
      // The tab's page, on the right of the navigation.
      const page = host.querySelector('[data-slot="chat-settings-tab"]')!;
      expect(page.querySelector('h2')?.textContent).toBe(`${label} page`);
      expect(page.previousElementSibling?.tagName).toBe('NAV');
    },
  );

  it('marks no tab on an address that is none of them', async () => {
    await render('/dashboard/chat/settings/unknown', <p>page</p>);
    expect(tabs()).toHaveLength(4);
    expect(marked()).toHaveLength(0);
  });

  it('keeps the navigation as a row of tabs on a narrow screen, as before', async () => {
    await render('/dashboard/chat/activity', <p>activity</p>);
    const navEl = host.querySelector('nav')!;
    expect(navEl.className).toContain('max-[900px]:flex');
    expect(navEl.className).toContain('max-[900px]:flex-wrap');
    expect(navEl.parentElement!.className).toContain('max-[900px]:flex-col');
  });

  it('draws no frame and no tab while the new Chat is off: the page answers alone', async () => {
    await render('/dashboard/chat/activity', <p data-testid="page">activity</p>, false);
    expect(host.querySelector('nav')).toBeNull();
    expect(host.querySelector('h1')).toBeNull();
    expect(tabs()).toHaveLength(0);
    expect(host.innerHTML).toBe('<p data-testid="page">activity</p>');
  });
});
