// @vitest-environment node
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { CHAT_POLICY_HREF, CHAT_SETTINGS_TABS, chatSettingsTabOf } from './settings-tabs';

/**
 * Chat's Settings tabs (owner request, 16 Nov 2026): General, Activity,
 * What Chat can do and Tool policy, in the chat menu's order and with its
 * labels, each at its own address inside Chat.
 */
describe('CHAT_SETTINGS_TABS', () => {
  it("lists the four tabs in the chat menu's order, named by the menu's words", () => {
    expect(CHAT_SETTINGS_TABS.map((tab) => [messages.chatShell.menu[tab.id], tab.href])).toEqual([
      ['General', '/dashboard/chat/settings'],
      ['Activity', '/dashboard/chat/activity'],
      ['What Chat can do', '/dashboard/chat/capabilities'],
      ['Tool policy', '/dashboard/chat/policy'],
    ]);
    expect(CHAT_SETTINGS_TABS.map((tab) => tab.menuAction)).toEqual([
      'chatMenu.openSettings',
      'chatMenu.openActivity',
      'chatMenu.openCapabilities',
      'chatMenu.openPolicy',
    ]);
  });

  it('keeps Tool policy inside Chat', () => {
    expect(CHAT_POLICY_HREF).toBe('/dashboard/chat/policy');
    for (const tab of CHAT_SETTINGS_TABS) expect(tab.href).toMatch(/^\/dashboard\/chat\//);
  });
});

describe('chatSettingsTabOf', () => {
  it('names the tab an address opens', () => {
    expect(chatSettingsTabOf('/dashboard/chat/settings')).toBe('general');
    expect(chatSettingsTabOf('/dashboard/chat/activity')).toBe('activity');
    expect(chatSettingsTabOf('/dashboard/chat/capabilities')).toBe('capabilities');
    expect(chatSettingsTabOf('/dashboard/chat/policy')).toBe('policy');
  });

  it('reads past a trailing slash, a query and a hash', () => {
    expect(chatSettingsTabOf('/dashboard/chat/activity/')).toBe('activity');
    expect(chatSettingsTabOf('/dashboard/chat/capabilities?q=x')).toBe('capabilities');
    expect(chatSettingsTabOf('/dashboard/chat/policy#tools')).toBe('policy');
  });

  it('names none for any other page', () => {
    for (const path of [
      '/dashboard/chat',
      '/dashboard/chat/inbox',
      '/dashboard/chat/settings/x',
      '/dashboard/settings/chat',
      '/dashboard/chat/aaaaaaaa-0000-4000-8000-000000000001',
    ]) {
      expect(chatSettingsTabOf(path), path).toBeNull();
    }
  });
});
