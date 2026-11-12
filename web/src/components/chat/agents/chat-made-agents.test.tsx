import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ScheduleListRead } from '@/lib/actions/chat-schedules';
import type { ScheduleListItem } from '@/lib/chat/schedule/views';

/**
 * Recurring work made in Chat on Action Center › Agents (SIMPLE_NAV; the
 * owner's option A): the person's own recurring jobs, "made in Chat", each
 * with a main button that opens its run in Chat (or runs it now when it
 * hasn't run), Pause / Resume, and Edit on its page in Chat › Scheduled.
 * Jobs done once, and others' jobs on an Admin's list, stay on Scheduled.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({
  listChatSchedules: vi.fn(),
  setChatScheduleOn: vi.fn(async () => ({ ok: true })),
  runChatScheduleNow: vi.fn(async () => ({ kind: 'started' })),
}));
vi.mock('@/lib/actions/chat-schedules', () => actions);
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const { ChatMadeAgents, madeInChat } = await import('./chat-made-agents');
const { track } = await import('@/lib/analytics');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = new Date('2026-11-04T09:00:00.000Z');
const CHAT = '/dashboard/chat/c1111111-1111-4111-8111-111111111111' as const;

const job = (over: Partial<ScheduleListItem> = {}): ScheduleListItem => ({
  id: 'a1111111-1111-4111-8111-111111111111',
  kind: 'recurring',
  title: 'Espresso watch',
  skill: null,
  prompt: 'Check my 3 espresso prompts and draft a fix for any we lose.',
  brand: 'Brewline',
  when: { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0' },
  timezone: 'UTC',
  nextRunAt: '2026-11-09T08:00:00.000Z',
  dueAt: null,
  enabled: true,
  pausedReason: null,
  deliver: 'chat',
  external: [],
  changeOnly: false,
  mode: 'auto',
  auto: false,
  createdBy: null,
  mine: true,
  lastRun: null,
  chatHref: CHAT,
  canManage: true,
  canEdit: true,
  canTakeOver: false,
  ...over,
});
const run = (status: string) => ({
  status,
  startedAt: '2026-11-02T08:00:00.000Z',
  endedAt: null,
  reason: null,
  partsDone: 1,
  partsTotal: 1,
  usageShare: 0.01,
  runNow: false,
  emailed: false,
});
const read = (jobs: ScheduleListItem[]): ScheduleListRead => ({
  ok: true,
  jobs,
  agents: [],
  admin: true,
  active: jobs.length,
  limit: 25,
  canCreate: true,
});

let container: HTMLDivElement;
let root: Root;

async function render(initial?: ScheduleListRead) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatMadeAgents initial={initial} now={NOW} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-slot="chat-made-agent"]')];
const inRow = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-action="madeInChat.${name}"]`);

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockClear());
  vi.mocked(track).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ChatMadeAgents', () => {
  it("lists the person's recurring jobs made in Chat, each with when it runs and what it does", async () => {
    await render(
      read([
        job(),
        job({ id: 'a2', kind: 'once', title: 'One-off check' }),
        job({ id: 'a3', title: "A teammate's job", mine: false }),
      ]),
    );
    expect(container.querySelector('h3')?.textContent).toBe('Made in Chat');
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Espresso watch']);
    const [row] = rows();
    expect(row.querySelector('[data-slot="chat-made-when"]')?.textContent).toBe(
      'Every Monday, 08:00 · made in Chat',
    );
    expect(row.textContent).toContain('Check my 3 espresso prompts');
    // Not run yet: its next run, and Run now.
    expect(row.querySelector('[data-slot="chat-made-status"]')?.textContent).toMatch(/^Next: /);
    expect(inRow(row, 'runNow')?.textContent).toBe('Run now');
    expect(inRow(row, 'openInChat')).toBeNull();
    expect(inRow(row, 'pauseResume')?.textContent).toBe('Pause');
    expect(inRow(row, 'edit')?.getAttribute('href')).toBe(
      '/dashboard/chat/scheduled/a1111111-1111-4111-8111-111111111111',
    );
  });

  it('opens its run in Chat once it has run: while it runs, while it needs you, or its last one', async () => {
    await render(
      read([
        job({ id: 'b1', lastRun: run('running') }),
        job({ id: 'b2', lastRun: run('needs_you') }),
        job({ id: 'b3', lastRun: run('done') }),
      ]),
    );
    const buttons = rows().map((row) => inRow(row, 'openInChat'));
    expect(buttons.map((b) => b?.textContent)).toEqual([
      'Open the run in Chat',
      'Review in Chat',
      'Open the last run',
    ]);
    expect(buttons.every((b) => b?.getAttribute('href') === CHAT)).toBe(true);
    expect(rows()[2].querySelector('[data-slot="chat-made-status"]')?.textContent).toBe(
      'Last run Mon 2 Nov, 08:00 · Done',
    );
    // The menu's dots: grey while it runs, yellow while it needs you, none once done.
    expect(
      rows().map(
        (row) =>
          row.querySelector<HTMLElement>('[data-slot="chat-made-status"] [data-menu-dot]')?.dataset
            .menuDot ?? null,
      ),
    ).toEqual(['grey', 'yellow', null]);
    buttons[1]!.addEventListener('click', (e) => e.preventDefault());
    await act(async () => buttons[1]!.click());
    expect(track).toHaveBeenCalledWith('agents_open_in_chat', { state: 'needsYou', made: 'chat' });
  });

  it('pauses, resumes and runs a job with the Scheduled page’s own actions, then reads them again', async () => {
    actions.listChatSchedules.mockResolvedValue(read([job({ enabled: false })]));
    await render(read([job()]));
    await act(async () => inRow(rows()[0], 'pauseResume')!.click());
    expect(actions.setChatScheduleOn).toHaveBeenCalledWith(
      'a1111111-1111-4111-8111-111111111111',
      false,
    );
    expect(inRow(rows()[0], 'pauseResume')?.textContent).toBe('Resume');
    await act(async () => inRow(rows()[0], 'runNow')!.click());
    expect(actions.runChatScheduleNow).toHaveBeenCalledWith('a1111111-1111-4111-8111-111111111111');
  });

  it('reads the jobs itself, and shows nothing when there are none or they can’t be read', async () => {
    actions.listChatSchedules.mockResolvedValueOnce(read([job()]));
    await render();
    expect(actions.listChatSchedules).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
    act(() => root.unmount());
    root = createRoot(container);
    actions.listChatSchedules.mockResolvedValueOnce({ ok: false });
    await render();
    expect(container.innerHTML).toBe('');
    expect(madeInChat(null)).toEqual([]);
    expect(madeInChat(read([job({ kind: 'once' })]))).toEqual([]);
  });
});
