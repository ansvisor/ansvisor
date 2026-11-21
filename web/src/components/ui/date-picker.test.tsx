import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { DatePicker } from './date-picker';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onChange.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function Picker({ start, locale = 'en' }: { start: string | null; locale?: string }) {
  const [value, setValue] = useState(start);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <DatePicker
        id="due"
        value={value}
        min="2026-11-10"
        max="2026-12-31"
        clearable
        onChange={(day) => {
          onChange(day);
          setValue(day);
        }}
      />
    </NextIntlClientProvider>
  );
}

const trigger = () => document.querySelector<HTMLButtonElement>('#due')!;
const day = (d: string) => document.querySelector<HTMLButtonElement>(`[data-day="${d}"]`);
const open = () => act(async () => trigger().click());
const key = (k: string, shiftKey = false) =>
  act(async () => {
    document
      .querySelector('[role="grid"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
  });

describe('DatePicker (UX audit AC-25)', () => {
  it('shows the day in the app’s language, and none as its placeholder', async () => {
    await act(async () => root.render(<Picker start="2026-11-18" />));
    expect(trigger().textContent).toBe('Nov 18, 2026');
    expect(trigger().dataset.value).toBe('2026-11-18');
    await act(async () => root.render(<Picker start="2026-11-18" locale="tr" />));
    expect(trigger().textContent).toBe('18 Kas 2026');
    await act(async () => root.render(<Picker key="none" start={null} />));
    expect(trigger().textContent).toBe('Pick a date');
  });

  it('opens on the picked month, its weeks starting as the locale’s do, and picks a day', async () => {
    await act(async () => root.render(<Picker start="2026-11-18" />));
    await open();
    expect(document.querySelector('[data-slot="date-picker-month"]')!.textContent).toBe(
      'November 2026',
    );
    // English (US) weeks start on Sunday.
    expect(document.querySelector('[role="columnheader"]')!.textContent).toBe('Sun');
    expect(day('2026-11-18')!.closest('[role="gridcell"]')!.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(day('2026-11-20')!.getAttribute('aria-current')).toBe('date');
    await act(async () => day('2026-11-25')!.click());
    expect(onChange).toHaveBeenLastCalledWith('2026-11-25');
    expect(document.querySelector('[role="grid"]')).toBeNull();
  });

  it('moves by the keyboard, keeps to its range, and picks with Enter', async () => {
    await act(async () => root.render(<Picker start="2026-11-18" />));
    await open();
    await key('ArrowRight');
    await key('ArrowDown');
    await key('Enter');
    expect(onChange).toHaveBeenLastCalledWith('2026-11-26');
    await open();
    await key('PageDown');
    expect(document.querySelector('[data-slot="date-picker-month"]')!.textContent).toBe(
      'December 2026',
    );
    // A year on is past the max: it stops at the last day it may.
    await key('PageDown', true);
    await key('Enter');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31');
  });

  it('won’t pick a day out of range, and clears with Clear', async () => {
    await act(async () => root.render(<Picker start="2026-11-18" />));
    await open();
    expect(day('2026-11-05')!.getAttribute('aria-disabled')).toBe('true');
    await act(async () => day('2026-11-05')!.click());
    expect(onChange).not.toHaveBeenCalled();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="datePicker.clear"]')!.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(trigger().textContent).toBe('Pick a date');
  });

  it('picks today with Today', async () => {
    await act(async () => root.render(<Picker start={null} />));
    await open();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="datePicker.today"]')!.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20');
  });
});
