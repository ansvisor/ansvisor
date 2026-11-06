import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The Agent work gear on Action Center › Today (AC-011, mockup screen 3):
 * there only where Chat is on, opening who starts agent work; an Admin
 * saves from it.
 */

const actions = vi.hoisted(() => ({ getAgentWorkView: vi.fn(), setAgentWork: vi.fn() }));
vi.mock('@/lib/actions/chat-settings', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { AgentWorkGear } = await import('./agent-work-gear');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const fn of [...Object.values(actions), ...Object.values(toast)]) fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AgentWorkGear />
      </NextIntlClientProvider>,
    );
  });
}

const trigger = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Agent work');

describe('AgentWorkGear', () => {
  it('stays away where Chat is off, or when it can’t be read', async () => {
    actions.getAgentWorkView.mockResolvedValue({ ok: false, failure: 'chat_off' });
    await render();
    expect(container.innerHTML).toBe('');
    actions.getAgentWorkView.mockRejectedValue(new Error('down'));
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('opens who starts agent work, and saves an Admin’s choice', async () => {
    actions.getAgentWorkView.mockResolvedValue({
      ok: true,
      view: { value: 'approve_first', canChange: true, lastChange: null },
    });
    actions.setAgentWork.mockResolvedValue({ ok: true });
    await render();
    expect(trigger()!.getAttribute('title')).toBe('Who starts agent work');
    await act(async () => trigger()!.click());
    expect(document.body.textContent).toContain('Who starts agent work?');
    const auto = document.body.querySelector<HTMLInputElement>('input[value="auto_start"]')!;
    await act(async () => auto.click());
    const save = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save',
    )!;
    await act(async () => save.click());
    expect(actions.setAgentWork).toHaveBeenCalledWith('auto_start');
    expect(toast.success).toHaveBeenCalledWith('Agent work saved');
    // Read again, with its new last change.
    expect(actions.getAgentWorkView).toHaveBeenCalledTimes(2);
  });

  it('says why a save failed', async () => {
    actions.getAgentWorkView.mockResolvedValue({
      ok: true,
      view: { value: 'approve_first', canChange: true, lastChange: null },
    });
    actions.setAgentWork.mockResolvedValue({ ok: false, failure: 'read_only' });
    await render();
    await act(async () => trigger()!.click());
    await act(async () =>
      document.body.querySelector<HTMLInputElement>('input[value="auto_start"]')!.click(),
    );
    const save = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save',
    )!;
    await act(async () => save.click());
    expect(toast.error).toHaveBeenCalledWith(
      'Your plan has ended: choose a plan to change settings.',
    );
  });
});
