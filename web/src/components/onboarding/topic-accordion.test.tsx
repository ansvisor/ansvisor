import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { TopicAccordion } from './topic-accordion';

/** A topic's suggested prompts as a checklist: ticked ones are the ones kept. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const data = {
  topic: 'Coffee',
  prompts: [
    { text: 'best coffee beans online', picked: true },
    { text: 'cheapest coffee grinder', picked: false },
  ],
};

async function render(onTogglePrompt = vi.fn(), defaultOpen = true) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TopicAccordion
          data={data}
          defaultOpen={defaultOpen}
          onRemoveTopic={vi.fn()}
          onAddPrompt={vi.fn()}
          onTogglePrompt={onTogglePrompt}
        />
      </NextIntlClientProvider>,
    );
  });
  return { container, root };
}

describe('TopicAccordion', () => {
  it('lists each prompt with its tick and counts the ticked ones', async () => {
    const { container, root } = await render();
    expect(container.textContent).toContain('1 of 2 ticked');
    const boxes = container.querySelectorAll('[role="checkbox"]');
    expect([...boxes].map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(container.textContent).toContain('cheapest coffee grinder');
    act(() => root.unmount());
  });

  it('reports the index of the prompt whose box is clicked', async () => {
    const onToggle = vi.fn();
    const { container, root } = await render(onToggle);
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1].click(),
    );
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(1);
    act(() => root.unmount());
  });

  it('keeps the prompts hidden until the topic is opened', async () => {
    const { container, root } = await render(vi.fn(), false);
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    act(() => root.unmount());
  });
});
