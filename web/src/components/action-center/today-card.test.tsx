import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionItem } from '@/lib/actions/action-center';
import type { TodayRead } from '@/lib/action-center/today';
import type { GettingStartedStep } from '@/lib/getting-started/steps';

/**
 * The Today card (AC-011, ROADMAP mockup screen 3): three things for today
 * in the server's order, each with why, its first step and who does it,
 * then the Next 7 and what was done this week; Getting started's next steps
 * while it runs.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { TodayCard } = await import('./today-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function action(id: string, overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id,
    actionNo: 1,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'new',
    payload: {},
    kpiKeys: [],
    assignee: null,
    dueDate: null,
    createdAt: '2026-10-16T09:05:31Z',
    updatedAt: '2026-10-16T09:05:31Z',
    taskTotal: 3,
    taskCompleted: 0,
    signalCount: 1,
    priorityScore: 80,
    priorityLevel: 'high',
    priorityReason: null,
    ...overrides,
  };
}

const actions = [
  action('a1', {
    priorityScore: 92,
    priorityReason: {
      change: 'lost',
      subject: { entity: 'prompts', count: 13 },
      demand: null,
      realDemand: null,
      commercial: false,
      heldBefore: false,
      days: 2,
      sources: 1,
    },
  }),
  action('a2', { category: 'growth', priorityScore: 85 }),
  action('a3', { category: 'fix', priorityScore: 81 }),
  action('a4', { category: 'compete', priorityScore: 74 }),
  action('a5', { category: 'protect', priorityScore: 71 }),
];

const read: TodayRead = {
  today: [
    {
      id: 'a1',
      suggested: true,
      firstStep: {
        taskKey: null,
        title: 'Add a direct answer',
        titleParams: {},
        url: '/blog/ai-search-monitoring',
      },
      who: 'me',
    },
    { id: 'a2', suggested: false, firstStep: null, who: 'agent' },
    {
      id: 'a3',
      suggested: false,
      firstStep: { taskKey: null, title: 'Update robots.txt', titleParams: {}, url: null },
      who: 'team',
    },
  ],
  next: [{ id: 'a4' }, { id: 'a5' }],
  doneThisWeek: 5,
};

let container: HTMLDivElement;
let root: Root;
const onOpenAction = vi.fn();
const onOpenStep = vi.fn();

async function render(props: Partial<Parameters<typeof TodayCard>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TodayCard
          read={read}
          loading={false}
          actions={actions}
          steps={null}
          onOpenAction={onOpenAction}
          onOpenStep={onOpenStep}
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('ol > li')];
const text = () => container.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onOpenAction.mockReset();
  onOpenStep.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('TodayCard', () => {
  it('lists today’s three in the server’s order, with why, the first step and who does it', async () => {
    await render();
    expect(text()).toContain('Today');
    expect(text()).toContain('3 things · ranked by Priority Score');
    const [first, second, third] = rows();
    expect(rows()).toHaveLength(3);
    expect(first.textContent).toContain('13 prompts');
    expect(first.textContent).toContain(
      'First step: Add a direct answer · /blog/ai-search-monitoring',
    );
    expect(first.textContent).toContain("Also today's suggestion in your Chat Inbox");
    expect(first.textContent).toContain('Me');
    expect(second.textContent).toContain('No step left to do');
    expect(second.textContent).toContain('Agent');
    expect(second.textContent).not.toContain('Chat Inbox');
    expect(third.textContent).toContain('First step: Update robots.txt');
    expect(third.textContent).toContain('Team');
    expect(
      third.querySelector('[title="No one\'s yet: anyone on the team can take it"]'),
    ).not.toBeNull();
  });

  it('opens the action from its title or its Open button', async () => {
    await render();
    const [first, second] = rows();
    await act(async () => first.querySelector('button')!.click());
    const open = [...second.querySelectorAll('button')].find((b) => b.textContent === 'Open')!;
    await act(async () => open.click());
    expect(onOpenAction.mock.calls).toEqual([['a1'], ['a2']]);
  });

  it('lists the Next ones under it and links what was done this week to History', async () => {
    await render();
    expect(text()).toContain('Next 2');
    const done = container.querySelector('a[href="/dashboard/action-center/history"]')!;
    expect(done.textContent).toBe('Done this week · 5');
    const next = [...container.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('74'),
    );
    expect(next).toHaveLength(1);
    expect(next[0].textContent).toContain('Compete');
    await act(async () => next[0].click());
    expect(onOpenAction).toHaveBeenCalledWith('a4');
  });

  it('leaves out an item whose action closed since the order was read', async () => {
    await render({
      actions: actions.map((a) => (a.id === 'a2' ? { ...a, status: 'completed' } : a)),
    });
    expect(rows()).toHaveLength(2);
    expect(text()).toContain('2 things');
  });

  it('says so when nothing waits on the person, and keeps what was done this week', async () => {
    await render({ read: { today: [], next: [], doneThisWeek: 1 } });
    expect(text()).not.toContain('ranked by Priority Score');
    expect(text()).toContain('Nothing waits on you today');
    expect(text()).toContain('Done this week · 1');
  });

  it('shows a placeholder while it loads, and nothing when it couldn’t be read', async () => {
    await render({ read: null, loading: true });
    expect(container.querySelector('section')).not.toBeNull();
    expect(rows()).toHaveLength(0);
    await render({ read: null, loading: false });
    expect(container.innerHTML).toBe('');
  });

  it('lists Getting started’s next three ready steps while it runs, and nothing under them', async () => {
    const step = (key: string, state: GettingStartedStep['state']) =>
      ({ key, state }) as unknown as GettingStartedStep;
    const steps = [
      step('kpis', 'done'),
      step('competitors', 'new'),
      step('topics', 'waiting'),
      step('prompts', 'new'),
      step('gsc', 'new'),
      step('ga', 'new'),
    ];
    await render({ steps });
    expect(text()).toContain('3 steps of Getting started, ready now');
    expect(rows()).toHaveLength(3);
    expect(text()).not.toContain('Done this week');
    expect(text()).not.toContain('Next');
    const open = [...rows()[1].querySelectorAll('button')].find((b) => b.textContent === 'Open')!;
    await act(async () => open.click());
    expect(onOpenStep).toHaveBeenCalledWith(steps[3]);
  });

  it('lists the actions when no Getting started step is ready', async () => {
    await render({ steps: [{ key: 'kpis', state: 'waiting' } as unknown as GettingStartedStep] });
    expect(rows()).toHaveLength(3);
    expect(text()).toContain('3 things');
  });
});
