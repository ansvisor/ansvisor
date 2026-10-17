import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const { toast, regenerate } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  regenerate: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/action-task-writer', () => ({ regenerateActionTasks: regenerate }));

const { RegenerateTasks } = await import('./regenerate-tasks');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  regenerate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RegenerateTasks', () => {
  it('asks first, saying what stays, then writes and reloads', async () => {
    regenerate.mockResolvedValueOnce({ written: 4, kept: 1 });
    const onDone = vi.fn();
    const onBusyChange = vi.fn();
    render(
      <RegenerateTasks
        actionId="a1"
        disabled={false}
        onBusyChange={onBusyChange}
        onDone={onDone}
      />,
    );

    act(() => button('Regenerate tasks').click());
    expect(container.textContent).toContain('Done, under-way and hand-added tasks stay.');
    expect(regenerate).not.toHaveBeenCalled();

    await act(async () => button('Regenerate').click());
    expect(regenerate).toHaveBeenCalledWith('a1');
    expect(toast.success).toHaveBeenCalledWith('4 tasks written');
    expect(onDone).toHaveBeenCalled();
    // The rest of the tab waited while the tasks were rewritten.
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it("words the server's reason, and a timeout", async () => {
    render(
      <RegenerateTasks actionId="a1" disabled={false} onBusyChange={() => {}} onDone={() => {}} />,
    );

    regenerate.mockResolvedValueOnce({
      error: 'server',
      code: 'budget',
      message: 'Budget used up',
    });
    act(() => button('Regenerate tasks').click());
    await act(async () => button('Regenerate').click());
    expect(toast.error).toHaveBeenCalledWith(
      "Writing tasks uses this month's AI budget, which is used up or not part of your plan.",
    );

    // A reason this build has no words for reads as the server wrote it.
    regenerate.mockResolvedValueOnce({ error: 'server', code: null, message: 'Server error: 502' });
    act(() => button('Regenerate tasks').click());
    await act(async () => button('Regenerate').click());
    expect(toast.error).toHaveBeenLastCalledWith('Server error: 502');

    regenerate.mockResolvedValueOnce({ error: 'timeout' });
    act(() => button('Regenerate tasks').click());
    await act(async () => button('Regenerate').click());
    expect(toast.error).toHaveBeenLastCalledWith(
      'Writing the tasks took too long. Please try again.',
    );
  });
});
