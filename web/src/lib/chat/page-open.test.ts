import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDeliverable } from './events';
import { keepPageChoice, pageChoiceMade, pageHrefOf, pageOpenOf } from './page-open';

const deliverable = (over: Partial<ChatDeliverable>): ChatDeliverable => ({
  title: 'Pricing FAQ',
  type: 'document',
  formats: ['html'],
  status: 'done',
  ...over,
});

describe('where a page Chat writes opens (W4-11)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads a saved choice, and asks for one it doesn’t offer yet (Open here)', () => {
    expect(pageOpenOf('chat')).toBe('chat');
    expect(pageOpenOf('editor')).toBe('editor');
    expect(pageOpenOf('here')).toBe('ask');
    expect(pageOpenOf(null)).toBe('ask');
  });

  it('finds the page a run wrote, and none for a report, a table or a file', () => {
    expect(
      pageHrefOf([
        deliverable({ type: 'report', href: '/dashboard/reports/r1' }),
        deliverable({ href: '/dashboard/content/editor/d1' }),
      ]),
    ).toBe('/dashboard/content/editor/d1');
    expect(
      pageHrefOf([deliverable({ type: 'table' }), deliverable({ href: '/dashboard/files/x' })]),
    ).toBeNull();
    expect(pageHrefOf([])).toBeNull();
  });

  it('remembers in the browser that a run’s card was answered', () => {
    expect(pageChoiceMade('run-1')).toBe(false);
    keepPageChoice('run-1', 'chat');
    expect(pageChoiceMade('run-1')).toBe(true);
    expect(pageChoiceMade('run-2')).toBe(false);
  });
});
