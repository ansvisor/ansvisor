import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sheet, SheetContent, SheetTitle } from './sheet';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function sheet(side?: 'start' | 'end' | 'left' | 'right') {
  await act(async () =>
    root.render(
      <Sheet open>
        <SheetContent side={side}>
          <SheetTitle>Guide</SheetTitle>
        </SheetContent>
      </Sheet>,
    ),
  );
  return document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!;
}

describe('a sheet’s side follows the reading direction (RTL)', () => {
  it('opens at the end by default: the right in English, mirrored in a right-to-left page', async () => {
    const content = await sheet();
    // data-side stays physical, so a caller's data-[side=right]: widths still apply.
    expect(content.dataset.side).toBe('right');
    expect(content.dataset.logical).toBe('end');
    expect(content.className).toContain('rtl:data-[logical=end]:left-0');
    expect(content.className).toContain('rtl:data-[logical=end]:data-open:slide-in-from-left-10');
  });

  it('opens at the start as the left in English, and keeps left and right physical', async () => {
    const start = await sheet('start');
    expect([start.dataset.side, start.dataset.logical]).toEqual(['left', 'start']);
    const right = await sheet('right');
    expect([right.dataset.side, right.dataset.logical]).toEqual(['right', undefined]);
  });
});
