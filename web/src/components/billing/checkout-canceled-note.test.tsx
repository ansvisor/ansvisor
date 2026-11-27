import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { CheckoutCanceledNote } from './checkout-canceled-note';

/** Back from a Stripe Checkout left without paying: said once, nothing charged. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let container: HTMLDivElement;

function render(demo = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CheckoutCanceledNote demo={demo} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe('CheckoutCanceledNote', () => {
  it('says nothing was charged, and takes the mark off the address', () => {
    window.history.replaceState(null, '', '/dashboard/settings/billing?checkout=canceled&tab=x');
    render();
    expect(container.textContent).toContain(
      'Your payment wasn’t completed, so nothing was charged.',
    );
    expect(container.textContent).toContain('You can try again whenever you’re ready.');
    expect(window.location.search).toBe('?tab=x');
  });

  it('offers the demo on the plan step', () => {
    window.history.replaceState(null, '', '/dashboard/onboarding?checkout=canceled');
    render(true);
    expect(container.textContent).toContain('explore the demo brand first, no card needed');
    expect(window.location.search).toBe('');
  });

  it('says nothing without the mark', () => {
    window.history.replaceState(null, '', '/dashboard/onboarding');
    render(true);
    expect(container.textContent).toBe('');
  });
});
