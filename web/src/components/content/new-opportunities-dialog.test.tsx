import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { NewOpportunitiesDialog } from './new-opportunities-dialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('@/lib/actions/topic', () => ({ getTopics: vi.fn(async () => []) }));
vi.mock('@/lib/actions/tracking', () => ({
  getBrandPrompts: vi.fn(async () => [{ id: 'p1', text: 'best crm for agencies' }]),
}));
// The prompt picker as a native select: Base UI's popup doesn't open in jsdom.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({
    items,
    onValueChange,
  }: {
    items: { value: string; label: string }[];
    onValueChange: (item: { value: string; label: string } | null) => void;
  }) => (
    <select
      data-combobox
      onChange={(e) => onValueChange(items.find((i) => i.value === e.target.value) ?? null)}
    >
      <option value="" />
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
  ComboboxValue: () => null,
}));

const onSubmit = vi.fn();
let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NewOpportunitiesDialog
          open
          onOpenChange={() => {}}
          brandId="b1"
          max={3}
          remaining={8}
          onSubmit={onSubmit}
        />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
const click = async (el: Element | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSubmit.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('New content opportunities', () => {
  it('asks for one opportunity for a prompt, since its group gets one', async () => {
    await render();
    expect(button('Generate 3')).toBeDefined();

    await click(button('Prompt'));
    expect(button('Generate 1')).toBeDefined();
    expect(button('More')!.disabled).toBe(true);
    expect(text()).toContain('One per prompt.');
    expect(text()).toContain('Uses 1 of your 8 remaining this month → 7 left after this.');

    const select = document.querySelector<HTMLSelectElement>('[data-combobox]')!;
    await act(async () => {
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Generate 1'));
    expect(onSubmit).toHaveBeenCalledWith({
      count: 1,
      topicId: null,
      promptId: 'p1',
      idea: null,
    });
  });

  it('brings the chosen count back when the focus leaves the prompt', async () => {
    await render();
    await click(button('Prompt'));
    await click(button('Let Ansvisor choose'));
    expect(button('Generate 3')).toBeDefined();
    expect(text()).not.toContain('One per prompt.');
  });
});
