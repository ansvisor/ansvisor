import { describe, expect, it } from 'vitest';
import { chatShortcutOf, shortcutLabel } from './chat-shortcuts';

/** The shell's keys (CHAT-23 P11): Ctrl+\ / ⌘\ and Ctrl+Shift+O / ⌘⇧O; Ctrl+B stays Bold. */

const key = (key: string, mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>>) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('chatShortcutOf', () => {
  it('reads the menu toggle and New chat on both keyboards', () => {
    expect(chatShortcutOf(key('\\', { ctrl: true }))).toBe('menu');
    expect(chatShortcutOf(key('\\', { meta: true }))).toBe('menu');
    expect(chatShortcutOf(key('O', { ctrl: true, shift: true }))).toBe('new');
    expect(chatShortcutOf(key('o', { meta: true, shift: true }))).toBe('new');
  });

  it('leaves Bold, plain keys and other chords alone', () => {
    expect(chatShortcutOf(key('b', { ctrl: true }))).toBeNull();
    expect(chatShortcutOf(key('\\', {}))).toBeNull();
    expect(chatShortcutOf(key('o', { ctrl: true }))).toBeNull();
    expect(chatShortcutOf(key('\\', { ctrl: true, alt: true }))).toBeNull();
  });
});

describe('shortcutLabel', () => {
  it('names the keys as each keyboard does', () => {
    expect(shortcutLabel('menu', false)).toBe('Ctrl+\\');
    expect(shortcutLabel('menu', true)).toBe('⌘\\');
    expect(shortcutLabel('new', true)).toBe('⌘⇧O');
  });
});
