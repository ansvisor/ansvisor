import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { DateRangeFilter } from './date-range-filter';

/**
 * The one date range control (#713): its label above the presets, the one
 * picked pressed; off, and without the label, for a tab row with no data
 * behind it yet (Ads).
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

function render(props: Partial<Parameters<typeof DateRangeFilter>[0]> = {}) {
  const onChange = vi.fn();
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DateRangeFilter
          value="30d"
          onChange={onChange}
          presets={['7d', '30d', '90d']}
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
  return onChange;
}

const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')];

describe('DateRangeFilter', () => {
  it('shows its label and picks a preset', () => {
    const onChange = render();
    expect(container.querySelector('label')?.textContent).toBe('Date Range');
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Date Range',
    );
    expect(buttons().map((b) => b.textContent)).toEqual(['7d', '30d', '90d']);
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(buttons().some((b) => b.disabled || b.hasAttribute('data-action'))).toBe(false);
    act(() => buttons()[0].click());
    expect(onChange).toHaveBeenCalledWith('7d');
  });

  it('can go without its label, still naming the group, and be off with an action id', () => {
    const onChange = render({ label: 'Period', labelHidden: true, disabled: true, action: 'x.y' });
    expect(container.querySelector('label')).toBeNull();
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Period');
    expect(buttons().every((b) => b.disabled && b.dataset.action === 'x.y')).toBe(true);
    act(() => buttons()[2].click());
    expect(onChange).not.toHaveBeenCalled();
  });
});
