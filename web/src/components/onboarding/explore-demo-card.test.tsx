import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ExploreDemoChoice, ExploreDemoLine } from './explore-demo-card';

/** Onboarding's plan step: the demo brand, for someone not ready to add a card. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const explore = vi.fn();

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}
const button = () => container.querySelector('button')!;

beforeEach(() => {
  explore.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExploreDemoChoice', () => {
  it('says the demo is a made-up brand, not the own one, and opens it', async () => {
    await render(<ExploreDemoChoice brandName="Acme" opening={false} onExplore={explore} />);
    expect(container.querySelector('h3')?.textContent).toBe('Look around a sample brand');
    expect(container.textContent).toContain('Brewline Coffee · sample data');
    // The demo brand and the own one stand out in the words.
    expect([...container.querySelectorAll('strong')].map((b) => b.textContent)).toEqual([
      'Brewline Coffee',
      'Acme',
    ]);
    expect(container.textContent).toContain(
      "You'll explore Brewline Coffee, a made-up brand with sample data, not Acme. You can open every page, but nothing runs or changes there. Acme stays saved, and tracking starts when you pick a plan. No card needed.",
    );
    expect(button().textContent).toBe('Explore the sample brand');
    await act(async () => button().click());
    expect(explore).toHaveBeenCalledTimes(1);
  });

  it('says "your brand" when the brand has no name yet', async () => {
    await render(<ExploreDemoChoice brandName={null} opening={false} onExplore={explore} />);
    expect(container.textContent).toContain('sample data, not your brand.');
    expect(container.textContent).toContain('Your brand stays saved');
  });

  it('says the demo is being set up while it opens', async () => {
    await render(<ExploreDemoChoice brandName="Acme" opening onExplore={explore} />);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Setting up the demo…');
  });
});

describe('ExploreDemoLine', () => {
  it('goes straight into the demo from one line', async () => {
    await render(<ExploreDemoLine opening={false} onExplore={explore} />);
    expect(container.textContent).toBe('Not ready for a card? Explore a sample brand first →');
    expect(button().textContent).toBe('Explore a sample brand first →');
    await act(async () => button().click());
    expect(explore).toHaveBeenCalledTimes(1);
  });

  it('waits while the demo opens', async () => {
    await render(<ExploreDemoLine opening onExplore={explore} />);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Setting up the demo…');
    await act(async () => button().click());
    expect(explore).not.toHaveBeenCalled();
  });
});
