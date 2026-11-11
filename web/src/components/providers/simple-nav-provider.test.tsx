import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimpleNavProvider, useSimpleNav } from './simple-nav-provider';

/**
 * The simplified layout's answer as the browser gets it: only what the
 * dashboard's layout read on the server, and off without it.
 */

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
});

function Probe() {
  return <span data-simple-nav={String(useSimpleNav())} />;
}

const answer = () => container.querySelector('span')?.getAttribute('data-simple-nav');

describe('SimpleNavProvider', () => {
  it('is off in a tree without the provider: the layout as it was', () => {
    act(() => root.render(<Probe />));
    expect(answer()).toBe('false');
  });

  it('hands down what the layout read', () => {
    act(() =>
      root.render(
        <SimpleNavProvider enabled>
          <Probe />
        </SimpleNavProvider>,
      ),
    );
    expect(answer()).toBe('true');
    act(() =>
      root.render(
        <SimpleNavProvider enabled={false}>
          <Probe />
        </SimpleNavProvider>,
      ),
    );
    expect(answer()).toBe('false');
  });
});
