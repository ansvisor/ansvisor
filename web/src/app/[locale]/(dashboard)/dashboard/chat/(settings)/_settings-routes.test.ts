// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pageExists } from '@/lib/app-pages';
import { CHAT_SETTINGS_TABS } from '@/lib/chat/settings-tabs';

/**
 * Chat's Settings tabs, one route each in the chat/(settings) group, under
 * the layout that draws the Settings frame. The group adds nothing to an
 * address, so every old link (deep links, the chat menu, Help) still opens
 * its page, now inside the frame. Tool policy in Chat is the app's
 * Settings › Chat section, behind the same gate as the other tabs, and the
 * app's own Settings › Chat stays where it was.
 */

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
const access = vi.hoisted(() => ({ open: true }));
vi.mock('../_chat-page-access', () => ({ chatPageOpen: async () => access.open }));
const Section = vi.hoisted(() => () => null);
vi.mock('@/components/chat-access/chat-settings-section', () => ({ ChatSettingsSection: Section }));
const Frame = vi.hoisted(() => () => null);
vi.mock('@/components/chat/chat-settings-frame', () => ({ ChatSettingsFrame: Frame }));

const GROUP = fileURLToPath(new URL('.', import.meta.url));
const CHAT = path.dirname(GROUP);

describe('the Settings route group', () => {
  it('holds a page for every tab, and only those, under one layout', () => {
    const files = readdirSync(GROUP, { recursive: true, encoding: 'utf8' })
      .filter((file) => /(^|\/)(page|layout|route|loading|error)\.tsx?$/.test(file))
      .sort();
    expect(files).toEqual(
      [
        'layout.tsx',
        ...CHAT_SETTINGS_TABS.map((tab) => `${path.basename(tab.href)}/page.tsx`),
      ].sort(),
    );
  });

  it('leaves no copy of a tab outside it, which would clash with its address', () => {
    for (const tab of CHAT_SETTINGS_TABS) {
      expect(existsSync(path.join(CHAT, path.basename(tab.href))), tab.href).toBe(false);
    }
  });

  it('keeps every address working: the four tabs, and the app’s Settings › Chat', () => {
    expect(CHAT_SETTINGS_TABS.map((tab) => tab.href)).toEqual([
      '/dashboard/chat/settings',
      '/dashboard/chat/activity',
      '/dashboard/chat/capabilities',
      '/dashboard/chat/policy',
    ]);
    for (const tab of CHAT_SETTINGS_TABS) expect(pageExists(tab.href), tab.href).toBe(true);
    expect(pageExists('/dashboard/settings/chat')).toBe(true);
  });

  it('draws the Settings frame around the tab', async () => {
    const { default: ChatSettingsLayout } = await import('./layout');
    const child = 'the tab';
    const drawn = ChatSettingsLayout({ children: child });
    expect(drawn.type).toBe(Frame);
    expect(drawn.props.children).toBe(child);
  });
});

describe('Tool policy in Chat', () => {
  beforeEach(() => {
    access.open = true;
    notFound.mockClear();
  });

  it('shows the app’s Settings › Chat section, titled Tool policy', async () => {
    const { default: ChatPolicyPage } = await import('./policy/page');
    const drawn = await ChatPolicyPage();
    expect(drawn.type).toBe(Section);
    expect(drawn.props).toEqual({ heading: 'policy' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('is not found while the new Chat is off, as the other tabs', async () => {
    access.open = false;
    const { default: ChatPolicyPage } = await import('./policy/page');
    await expect(ChatPolicyPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
