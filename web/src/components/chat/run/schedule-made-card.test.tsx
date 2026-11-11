import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { SimpleNavProvider } from '@/components/providers/simple-nav-provider';
import type { ChatScheduleMade } from '@/lib/chat/events';

/**
 * The card under an answer that set up recurring work (SIMPLE_NAV; mockup
 * Chat-ajan.dc.html): "Set up: {title}" and when it runs, Run it now (one
 * run at once, as the Scheduled page's), Open in Agents and Change the
 * schedule (the job's page). Nothing with the flag off.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/chat-schedules', () => ({
  runChatScheduleNow: vi.fn(async () => ({ kind: 'started' })),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const { scheduleIdOf } = await import('./schedule-made-card');
const { ScheduleMadeCards } = await import('./schedule-made-cards');
const { runChatScheduleNow } = await import('@/lib/actions/chat-schedules');
const { track } = await import('@/lib/analytics');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const JOB = '5c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const MADE: ChatScheduleMade = {
  title: 'Espresso watch',
  when: 'Every Monday, 08:00 · Europe/Istanbul',
  href: `/dashboard/chat/scheduled/${JOB}`,
};

let container: HTMLDivElement;
let root: Root;

async function render(cards: ChatScheduleMade[], simpleNav = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SimpleNavProvider enabled={simpleNav}>
          <ScheduleMadeCards cards={cards} />
        </SimpleNavProvider>
      </NextIntlClientProvider>,
    );
  });
  // The card loads on its own, once there is one to show.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
const action = (name: string) =>
  container.querySelector<HTMLElement>(`[data-action="scheduleMade.${name}"]`);
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  vi.mocked(runChatScheduleNow).mockClear();
  vi.mocked(track).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ScheduleMadeCards', () => {
  it('says what was set up and when it runs, with Run it now, Open in Agents and Change the schedule', async () => {
    await render([MADE]);
    const card = container.querySelector<HTMLElement>('[data-slot="schedule-made-card"]')!;
    expect(card.getAttribute('aria-label')).toBe('Recurring work set up');
    expect(card.textContent).toContain('Set up: Espresso watch');
    expect(card.querySelector('[data-slot="schedule-made-when"]')?.textContent).toBe(
      'Every Monday, 08:00 · Europe/Istanbul',
    );
    expect(card.textContent).toContain('Action Center › Agents, made in Chat');
    expect(action('runNow')?.textContent).toBe('Run it now');
    expect(action('openAgents')?.getAttribute('href')).toBe('/dashboard/agents');
    expect(action('openAgents')?.textContent).toBe('Open in Agents');
    expect(action('change')?.getAttribute('href')).toBe(MADE.href);
    expect(action('change')?.textContent).toBe('Change the schedule');
  });

  it('runs the job once now, as the Scheduled page does, and says so', async () => {
    await render([MADE]);
    await click(action('runNow')!);
    expect(runChatScheduleNow).toHaveBeenCalledWith(JOB);
    expect(toast.success).toHaveBeenCalledWith('Running now · the result shows up in your Inbox');
    expect(track).toHaveBeenCalledWith('chat_agent_card_action', { action: 'run_now' });

    vi.mocked(runChatScheduleNow).mockResolvedValueOnce({ kind: 'busy' });
    await click(action('runNow')!);
    expect(toast.error).toHaveBeenLastCalledWith('Every run slot is busy. Try again in a minute.');
    vi.mocked(runChatScheduleNow).mockResolvedValueOnce({ kind: 'forbidden' });
    await click(action('runNow')!);
    expect(toast.error).toHaveBeenLastCalledWith('Only its creator or an Admin can do that.');
  });

  it('counts Open in Agents and Change the schedule', async () => {
    await render([MADE]);
    action('openAgents')!.addEventListener('click', (e) => e.preventDefault());
    action('change')!.addEventListener('click', (e) => e.preventDefault());
    await click(action('openAgents')!);
    await click(action('change')!);
    expect(vi.mocked(track).mock.calls).toEqual([
      ['chat_agent_card_action', { action: 'open_agents' }],
      ['chat_agent_card_action', { action: 'change_schedule' }],
    ]);
  });

  it('shows nothing with the flag off, or without a card', async () => {
    await render([MADE], false);
    expect(container.innerHTML).toBe('');
    await render([]);
    expect(container.innerHTML).toBe('');
  });

  it("reads the job's handle from its page's address only", () => {
    expect(scheduleIdOf(MADE.href)).toBe(JOB);
    expect(scheduleIdOf('/dashboard/chat/scheduled')).toBeNull();
    expect(scheduleIdOf(`/dashboard/agents/${JOB}`)).toBeNull();
  });
});
