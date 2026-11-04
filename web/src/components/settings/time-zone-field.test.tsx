import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Settings › Account › Time zone (00468): Automatic by default, with the
 * browser's zone beside it, or a fixed IANA zone from a searchable list;
 * saved as it is picked, and put back when the save fails.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const actions = vi.hoisted(() => ({
  getAccountTimeZone: vi.fn(),
  updateAccountTimeZone: vi.fn(),
}));
vi.mock('@/lib/actions/organization', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// The browser's own zone, whatever machine runs the test.
vi.mock('@/lib/time-zone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/time-zone')>()),
  viewerTimeZone: () => 'Europe/Istanbul',
}));
// The picker as a native select: Base UI's popup doesn't open in jsdom.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({
    items,
    value,
    disabled,
    onValueChange,
  }: {
    items: { value: string; label: string }[];
    value: { value: string } | null;
    disabled?: boolean;
    onValueChange: (item: { value: string; label: string } | null) => void;
  }) => (
    <select
      data-combobox
      value={value?.value ?? ''}
      disabled={disabled}
      onChange={(e) => onValueChange(items.find((i) => i.value === e.target.value) ?? null)}
    >
      {items.map((i) => (
        <option key={i.value} value={i.value}>
          {i.label}
        </option>
      ))}
    </select>
  ),
  ComboboxCollection: () => null,
  ComboboxContent: () => null,
  ComboboxEmpty: () => null,
  ComboboxInput: () => null,
  ComboboxItem: () => null,
  ComboboxList: () => null,
  ComboboxTrigger: () => null,
}));

const { TimeZoneField } = await import('./time-zone-field');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  actions.getAccountTimeZone.mockResolvedValue(null);
  actions.updateAccountTimeZone.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TimeZoneField />
      </NextIntlClientProvider>,
    );
  });
}
const picker = () => container.querySelector<HTMLSelectElement>('[data-combobox]')!;
const selected = () => picker().selectedOptions[0]?.textContent;
async function pick(value: string) {
  await act(async () => {
    picker().value = value;
    picker().dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('TimeZoneField', () => {
  it('starts on Automatic, with the browser’s zone beside it, and says what uses it', async () => {
    await render();
    expect(container.textContent).toContain('Time zone');
    expect(selected()).toBe('Automatic (Europe/Istanbul)');
    // Automatic first, then the IANA zones.
    const options = [...picker().options].map((o) => o.value);
    expect(options[0]).toBe('automatic');
    expect(options).toContain('America/New_York');
    expect(options).toContain('UTC');
    expect(container.textContent).toContain('Jobs you already have keep their own.');
  });

  it('shows the zone the person picked, and saves a new pick or Automatic as it changes', async () => {
    actions.getAccountTimeZone.mockResolvedValue('Asia/Tokyo');
    await render();
    expect(selected()).toBe('Asia/Tokyo');
    await pick('America/New_York');
    expect(actions.updateAccountTimeZone).toHaveBeenLastCalledWith('America/New_York');
    expect(toast.success).toHaveBeenCalledWith('Time zone saved');
    expect(selected()).toBe('America/New_York');
    await pick('automatic');
    expect(actions.updateAccountTimeZone).toHaveBeenLastCalledWith(null);
    expect(selected()).toBe('Automatic (Europe/Istanbul)');
  });

  it('puts the last zone back when the save fails', async () => {
    actions.getAccountTimeZone.mockResolvedValue('Asia/Tokyo');
    actions.updateAccountTimeZone.mockRejectedValue(new Error('down'));
    await render();
    await pick('America/New_York');
    expect(toast.error).toHaveBeenCalledWith('Couldn’t save your time zone. Try again.');
    expect(selected()).toBe('Asia/Tokyo');
  });

  it('keeps a saved zone this browser doesn’t list, so it still shows as picked', async () => {
    actions.getAccountTimeZone.mockResolvedValue('Etc/GMT-14');
    await render();
    expect(selected()).toBe('Etc/GMT-14');
  });
});
