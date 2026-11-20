import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { KpiSnapshot } from '@/lib/actions/kpis';
import { KpiTable } from './kpi-table';

/** "Goal passed · Set a new goal" (UX audit AC-62): offered 20% up, saved only on Save. */

vi.mock('next/dynamic', () => ({ default: () => () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const passed: KpiSnapshot = {
  key: 'mentions',
  category: 'visibility',
  unit: 'count',
  direction: 'higher_is_better',
  timeframe: 'monthly',
  value: 21_355,
  change: 12,
  changeKind: 'percent',
  trend: [],
  target: 17_800,
  progress: 120,
  status: 'goal_reached',
} as KpiSnapshot;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(kpi: KpiSnapshot, onSetGoal?: (key: string, target: number) => void) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <KpiTable kpis={[kpi]} busyKey={null} onSetGoal={onSetGoal} />
      </NextIntlClientProvider>,
    );
  });
}

const prompt = () => container.querySelector<HTMLButtonElement>('[data-action="kpis.setNewGoal"]');

describe('a passed goal (UX audit AC-62)', () => {
  it('offers a new goal 20% above the value, and saves it only on Save', async () => {
    const onSetGoal = vi.fn();
    await render(passed, onSetGoal);
    expect(prompt()!.textContent).toBe('Goal passed · Set a new goal');
    await act(async () => prompt()!.click());
    const field = document.querySelector<HTMLInputElement>('[data-action="kpis.newGoalValue"]')!;
    // 21,355 × 1.2, rounded up.
    expect(field.value).toBe('25626');
    expect(onSetGoal).not.toHaveBeenCalled();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="kpis.saveNewGoal"]')!.click(),
    );
    expect(onSetGoal).toHaveBeenCalledWith('mentions', 25_626);
  });

  it('offers nothing for a goal not reached, or on the unsaved ready-made set', async () => {
    await render({ ...passed, status: 'on_track', progress: 90 }, vi.fn());
    expect(prompt()).toBeNull();
    await render(passed);
    expect(prompt()).toBeNull();
  });

  it('shows the exact goal on hover, so compact goals that look alike can be told apart', async () => {
    await render(passed);
    const goal = [...container.querySelectorAll('td[title]')];
    expect(goal.map((td) => td.getAttribute('title'))).toEqual(['17,800']);
  });
});
