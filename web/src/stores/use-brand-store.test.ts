import { beforeEach, describe, expect, it } from 'vitest';
import type { Brand } from '@/types';

// An in-memory localStorage for the store to persist to: the test environment has none.
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, String(value)),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  },
});
const { useBrandStore } = await import('./use-brand-store');

const brand = (id: string) => ({ id, name: id }) as unknown as Brand;

beforeEach(() => {
  useBrandStore.setState({ brands: [], activeBrandId: null });
});

describe('the brand store', () => {
  it('keeps the brand chosen last time while it is still one of the member’s', () => {
    useBrandStore.setState({ activeBrandId: 'b2' });
    useBrandStore.getState().setBrands([brand('b1'), brand('b2')]);
    expect(useBrandStore.getState().activeBrandId).toBe('b2');
  });

  // BUG-001: a brand deleted, or another workspace's, answered every call with 404 or 403.
  it('drops a brand that is no longer the member’s for their first one', () => {
    useBrandStore.setState({ activeBrandId: 'gone' });
    useBrandStore.getState().setBrands([brand('b1'), brand('b2')]);
    expect(useBrandStore.getState().activeBrandId).toBe('b1');

    useBrandStore.getState().setBrands([]);
    expect(useBrandStore.getState().activeBrandId).toBeNull();
  });
});
