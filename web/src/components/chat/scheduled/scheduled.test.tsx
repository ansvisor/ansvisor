import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { ScheduleListItem } from '@/lib/chat/schedule/views';

/**
 * The Scheduled page and a job's page (W3-03; mockup #s-sched; CHAT-12
 * items 21–24): each row's job, When on its own clock with its next run or
 * why it is off, its last run, where its result goes and its mode, the
 * switch and its one action; a job's page reads When as it is typed with
 * its next 3 runs, on the job's own time zone, which it changes (00468),
 * saves its edits and lists its runs' use as a share.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({
  listChatSchedules: vi.fn(),
  getChatSchedule: vi.fn(),
  setChatScheduleOn: vi.fn(async () => ({ ok: true })),
  deleteChatSchedule: vi.fn(async () => ({ ok: true })),
  takeOverChatSchedule: vi.fn(async () => ({ ok: true })),
  runChatScheduleNow: vi.fn(async () => ({ kind: 'started' })),
  updateChatSchedule: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/actions/chat-schedules', () => actions);
// The time zone picker as a native select: Base UI's popup doesn't open in jsdom.
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

const { ScheduledList } = await import('./scheduled-list');
const { ScheduleDetail } = await import('./schedule-detail');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Monday 2 November 2026, 12:00 in Istanbul.
const NOW = new Date('2026-11-02T09:00:00.000Z');
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  actions.listChatSchedules.mockResolvedValue({ ok: false });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(ui: ReactElement) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Istanbul">
        <UpgradeDialogContext.Provider
          value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade: vi.fn() }}
        >
          {ui}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
}
const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};

const JOB: ScheduleListItem = {
  id: 'a1111111-1111-4111-8111-111111111111',
  kind: 'recurring',
  title: 'Weekly report',
  skill: 'report',
  prompt: 'Summarise last week',
  brand: 'Ansvisor',
  when: { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=0' },
  timezone: 'Europe/Istanbul',
  nextRunAt: '2026-11-09T05:00:00.000Z',
  dueAt: null,
  enabled: true,
  pausedReason: null,
  deliver: 'both',
  changeOnly: false,
  mode: 'auto',
  auto: false,
  createdBy: null,
  mine: true,
  lastRun: {
    status: 'done',
    startedAt: '2026-11-02T05:02:00.000Z',
    endedAt: '2026-11-02T05:04:00.000Z',
    reason: null,
    partsDone: 1,
    partsTotal: 3,
    usageShare: 0.006,
    runNow: false,
    emailed: true,
  },
  chatHref: '/dashboard/chat/c1111111-1111-4111-8111-111111111111',
  canManage: true,
  canEdit: true,
  canTakeOver: false,
};

const list = (jobs: ScheduleListItem[]) => ({
  ok: true as const,
  jobs,
  agents: [
    {
      agentName: 'Win back',
      config: {
        type: 'recurring',
        rrule: 'FREQ=WEEKLY;BYDAY=TH;BYHOUR=9;BYMINUTE=0',
        timezone: 'Europe/Istanbul',
      },
      enabled: true,
      nextRunAt: '2026-11-05T06:00:00.000Z',
      href: '/dashboard/agents/g1' as const,
    },
  ],
  admin: false,
  active: 1,
  limit: 25,
  canCreate: true,
});

describe('ScheduledList', () => {
  it('lists each job as the mockup does: when, last run, where it goes, mode, switch and Open last', async () => {
    actions.listChatSchedules.mockResolvedValue(list([JOB]));
    await render(<ScheduledList initial={list([JOB])} now={NOW} />);
    expect($('h1')!.textContent).toBe('Scheduled');
    expect(container.textContent).toContain('1 of 25 jobs on');
    expect($('[data-action="schedule.new"]')!.getAttribute('href')).toBe(
      '/dashboard/chat?compose=Every%20Monday%20at%209%3A00%2C%20',
    );
    const [row] = $$('[data-slot="scheduled-row"]');
    expect(row.textContent).toContain('Weekly report');
    expect(row.textContent).toContain('/report · Ansvisor');
    expect(row.textContent).toContain('Every Monday, 08:00');
    expect(row.textContent).toContain('Next: Mon 9 Nov, 08:00');
    expect(row.textContent).toContain('Done');
    expect(row.textContent).toContain('Mon 2 Nov, 08:02 · 1 of 3 ready · emailed');
    expect(row.textContent).toContain('Email · Inbox');
    expect(row.textContent).toContain('Auto, ask before changes');
    expect(row.querySelector('[data-action="schedule.openLast"]')!.getAttribute('href')).toBe(
      JOB.chatHref,
    );
    expect(row.querySelector('[data-action="schedule.open"]')!.getAttribute('href')).toBe(
      `/dashboard/chat/scheduled/${JOB.id}`,
    );
    const agent = $('[data-slot="scheduled-agent"]')!;
    expect(agent.textContent).toContain('Agent: Win back');
    expect(agent.querySelector('a')!.getAttribute('href')).toBe('/dashboard/agents/g1');

    await click(row.querySelector('[data-action="schedule.toggleJob"]'));
    expect(actions.setChatScheduleOn).toHaveBeenCalledWith(JOB.id, false);
    expect(actions.listChatSchedules).toHaveBeenCalled();
  });

  it('says why a job is off and offers Run now; Take over to an Admin; Cancel on a follow-up check', async () => {
    const off = { ...JOB, enabled: false, pausedReason: 'cap', lastRun: null, nextRunAt: null };
    const left = {
      ...JOB,
      id: 'b2222222-2222-4222-8222-222222222222',
      enabled: false,
      pausedReason: 'owner_role',
      mine: false,
      canEdit: false,
      canTakeOver: true,
      createdBy: 'Alex Kim',
    };
    const check = {
      ...JOB,
      id: 'c3333333-3333-4333-8333-333333333333',
      kind: 'followup_check' as const,
      title: 'Citations for /pricing',
      when: null,
      dueAt: '2026-11-09T06:00:00.000Z',
      auto: true,
      canEdit: false,
    };
    await render(<ScheduledList initial={list([off, left, check])} now={NOW} />);
    const [first, second, third] = $$('[data-slot="scheduled-row"]');
    expect(first.textContent).toContain('Paused · AI limit reached');
    expect(first.textContent).toContain('Not run yet');
    await click(first.querySelector('[data-action="schedule.runNow"]'));
    expect(actions.runChatScheduleNow).toHaveBeenCalledWith(JOB.id);
    expect(second.textContent).toContain('by Alex Kim');
    await click(second.querySelector('[data-action="schedule.takeOver"]'));
    expect(actions.takeOverChatSchedule).toHaveBeenCalledWith(left.id);
    expect(third.textContent).toContain('Follow-up check · Set by a Full auto run for you');
    expect(third.textContent).toContain('Mon 9 Nov, 09:00');
    await click(third.querySelector('[data-action="schedule.cancelJob"]'));
    expect(actions.deleteChatSchedule).toHaveBeenCalledWith(check.id);
  });

  it('says when nothing is scheduled, and when it couldn’t be read', async () => {
    await render(<ScheduledList initial={{ ...list([]), agents: [] }} now={NOW} />);
    expect(container.textContent).toContain('No scheduled work yet.');
    await render(<ScheduledList key="failed" initial={{ ok: false }} now={NOW} />);
    expect(container.textContent).toContain('Couldn’t load your scheduled work.');
  });
});

describe('ScheduleDetail', () => {
  const RUNS = [
    JOB.lastRun!,
    {
      ...JOB.lastRun!,
      status: 'unchanged',
      usageShare: 0.0004,
      startedAt: '2026-10-26T05:02:00.000Z',
      runNow: true,
      emailed: false,
      partsTotal: 0,
      partsDone: 0,
    },
  ];

  it('reads When as it is typed, with its next 3 runs, and saves the edits', async () => {
    actions.getChatSchedule.mockResolvedValue({ job: JOB, runs: RUNS });
    await render(<ScheduleDetail initial={{ job: JOB, runs: RUNS }} now={NOW} />);
    const when = $('[data-action="schedule.when"]') as HTMLInputElement;
    expect(when.value).toBe('every Monday at 08:00');
    expect(container.textContent).toContain('Every Monday, 08:00 · Europe/Istanbul');
    expect($$('[data-slot="schedule-next-runs"] li').map((li) => li.textContent)).toEqual([
      'Mon 9 Nov, 08:00',
      'Mon 16 Nov, 08:00',
      'Mon 23 Nov, 08:00',
    ]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        when,
        'next Friday',
      );
      when.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('That could be');
    expect(($('[data-action="schedule.save"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        when,
        'every weekday at 7',
      );
      when.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click($('[data-action="schedule.save"]'));
    expect(actions.updateChatSchedule).toHaveBeenCalledWith(JOB.id, {
      title: 'Weekly report',
      prompt: 'Summarise last week',
      when: 'every weekday at 7',
      deliver: 'both',
      changeOnly: false,
      timezone: 'Europe/Istanbul',
    });
    // Its runs: status, run now, and use as a share, never dollars.
    const rows = $$('[data-slot="schedule-run"]');
    expect(rows[0].textContent).toContain('Done');
    expect(rows[0].textContent).toContain('0.6%');
    expect(rows[1].textContent).toContain('No change');
    expect(rows[1].textContent).toContain('Run now');
    expect(rows[1].textContent).toContain('<0.1%');
    expect(container.textContent).not.toContain('$');
  });

  it('shows the job’s own time zone, and reads When on the one picked before Save sends it', async () => {
    await render(<ScheduleDetail initial={{ job: JOB, runs: RUNS }} now={NOW} />);
    const zone = $('[data-combobox]') as HTMLSelectElement;
    expect(zone.value).toBe('Europe/Istanbul');
    expect(container.textContent).toContain('This job’s own clock.');
    // No Automatic here: a job always runs on a zone of its own.
    expect([...zone.options].some((o) => o.textContent?.startsWith('Automatic'))).toBe(false);
    await act(async () => {
      zone.value = 'America/New_York';
      zone.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Every Monday, 08:00 · America/New_York');
    // It's 04:00 on Monday in New York: today's 08:00 there (13:00 UTC) comes first now.
    expect($$('[data-slot="schedule-next-runs"] li').map((li) => li.textContent)).toEqual([
      'Mon 2 Nov, 08:00',
      'Mon 9 Nov, 08:00',
      'Mon 16 Nov, 08:00',
    ]);
    await click($('[data-action="schedule.save"]'));
    expect(actions.updateChatSchedule).toHaveBeenCalledWith(
      JOB.id,
      expect.objectContaining({ when: 'every Monday at 08:00', timezone: 'America/New_York' }),
    );
  });

  it('saves a title edit of a one-time job whose time passed, until When is changed', async () => {
    const past = {
      ...JOB,
      kind: 'once' as const,
      when: {
        kind: 'once' as const,
        runMode: 'run_at' as const,
        dueAt: '2026-10-30T06:00:00.000Z',
      },
      nextRunAt: null,
      dueAt: '2026-10-30T06:00:00.000Z',
    };
    actions.updateChatSchedule.mockClear();
    actions.getChatSchedule.mockResolvedValue({ job: past, runs: [] });
    await render(<ScheduleDetail initial={{ job: past, runs: [] }} now={NOW} />);
    const when = $('[data-action="schedule.when"]') as HTMLInputElement;
    const kept = when.value;
    expect(when.getAttribute('aria-invalid')).toBeNull();
    const title = $('[data-action="schedule.title"]') as HTMLInputElement;
    const type = async (el: HTMLInputElement, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type(title, 'Launch recap');
    const save = $('[data-action="schedule.save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await click(save);
    expect(actions.updateChatSchedule).toHaveBeenCalledWith(
      JOB.id,
      expect.objectContaining({ title: 'Launch recap', when: kept }),
    );
    // A When typed to another past time is still refused.
    await type(when, '29 Oct 2026 at 09:00');
    expect(when.getAttribute('aria-invalid')).toBe('true');
    expect(($('[data-action="schedule.save"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets an Admin switch or delete a teammate’s job, not edit it', async () => {
    const theirs = { ...JOB, mine: false, canEdit: false, chatHref: null };
    await render(<ScheduleDetail initial={{ job: theirs, runs: [] }} now={NOW} />);
    expect(container.textContent).toContain('Only its creator can change this job.');
    expect(($('[data-combobox]') as HTMLSelectElement).disabled).toBe(true);
    expect($('[data-action="schedule.save"]')).toBeNull();
    expect($('[data-action="schedule.runNow"]')).toBeNull();
    await click($('[data-action="schedule.delete"]'));
    await click(document.body.querySelector('[data-action="confirm.ok"]'));
    expect(actions.deleteChatSchedule).toHaveBeenCalledWith(JOB.id);
  });
});
