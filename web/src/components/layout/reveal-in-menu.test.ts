// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealInMenu } from './reveal-in-menu';

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;

function menu(itemTop: number) {
  const box = document.createElement('div');
  box.style.overflowY = 'auto';
  Object.defineProperty(box, 'scrollHeight', { value: 2000 });
  Object.defineProperty(box, 'clientHeight', { value: 400 });
  box.getBoundingClientRect = () => rect(0, 400);
  const item = document.createElement('a');
  item.getBoundingClientRect = () => rect(itemTop, 32);
  box.appendChild(item);
  document.body.appendChild(box);
  return { box, item };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the sidebar brings its current item into view only when it is out of it (UX audit GL-02)', () => {
  it('leaves the menu where it is for an item on screen', () => {
    const { box, item } = menu(100);
    revealInMenu(item);
    expect(box.scrollTop).toBe(0);
  });

  it('scrolls an item below the fold to the middle of the menu', () => {
    const { box, item } = menu(900);
    revealInMenu(item);
    // 900 − (400 − 32) / 2 = 716.
    expect(box.scrollTop).toBe(716);
  });

  it('does nothing without an item or a menu that scrolls', () => {
    expect(() => revealInMenu(null)).not.toThrow();
    const item = document.createElement('a');
    document.body.appendChild(item);
    expect(() => revealInMenu(item)).not.toThrow();
  });
});
