import { describe, expect, it } from 'vitest';
import {
  ACTION_CENTER_REVIEW,
  ACTION_CENTER_TABS,
  ACTION_CENTER_TODAY,
  actionCenterTabOf,
  agentsWaitingOn,
} from './tabs';

/** The Action Center's tabs: Today, Actions, Signals, Agents and History, KPIs a History view. */

describe('the Action Center tabs', () => {
  it('are Today, Actions, Signals, Agents and History, Agents at Agent Center’s address', () => {
    expect(ACTION_CENTER_TABS.map((tab) => tab.key)).toEqual([
      'today',
      'actions',
      'signals',
      'agents',
      'history',
    ]);
    expect(ACTION_CENTER_TABS[0].href).toBe(ACTION_CENTER_TODAY);
    expect(ACTION_CENTER_TABS.find((tab) => tab.key === 'agents')?.href).toBe('/dashboard/agents');
    expect(ACTION_CENTER_REVIEW).toBe('/dashboard/action-center/review');
  });
});

describe('actionCenterTabOf', () => {
  it('names the tab a page is under, the pages under it included', () => {
    expect(actionCenterTabOf('/dashboard/action-center/today')).toBe('today');
    expect(actionCenterTabOf('/dashboard/action-center/actions')).toBe('actions');
    expect(actionCenterTabOf('/dashboard/action-center/actions/AC-12')).toBe('actions');
    expect(actionCenterTabOf('/dashboard/action-center/signals')).toBe('signals');
    expect(actionCenterTabOf('/dashboard/agents')).toBe('agents');
    expect(actionCenterTabOf('/dashboard/agents/new')).toBe('agents');
    expect(actionCenterTabOf('/dashboard/agents/abc/edit')).toBe('agents');
    expect(actionCenterTabOf('/dashboard/action-center/history')).toBe('history');
  });

  it('shows History on KPIs, one of its views', () => {
    expect(actionCenterTabOf('/dashboard/action-center/kpis')).toBe('history');
  });

  it('shows none on Needs review or off the Action Center', () => {
    expect(actionCenterTabOf('/dashboard/action-center/review')).toBeNull();
    expect(actionCenterTabOf('/dashboard/agent')).toBeNull();
    expect(actionCenterTabOf('/dashboard/agentsx')).toBeNull();
    expect(actionCenterTabOf('/dashboard/insights')).toBeNull();
  });
});

describe('agentsWaitingOn', () => {
  const agent = (status: string, run: string | null) => ({
    status,
    lastRun: run ? { status: run } : null,
  });

  it('counts the agents whose newest run needs the person, as their cards say', () => {
    expect(
      agentsWaitingOn([
        agent('active', 'needs_you'),
        agent('paused', 'needs_you'),
        agent('active', 'running'),
        agent('active', 'succeeded'),
        agent('draft', null),
      ]),
    ).toBe(2);
  });

  it('leaves archived agents out, and is 0 for none', () => {
    expect(agentsWaitingOn([agent('archived', 'needs_you')])).toBe(0);
    expect(agentsWaitingOn([])).toBe(0);
  });
});
