import { describe, expect, it } from 'vitest';
import {
  ACTION_CENTER_TABS,
  ACTION_CENTER_TODAY,
  REVIEW_TAB,
  SIMPLE_TABS,
  agentsWaitingOn,
  simpleTabOf,
} from './tabs';

/**
 * The Action Center's tabs: as they were without SIMPLE_NAV; Today, Actions,
 * Signals, Agents and History with it, KPIs a History view.
 */

describe('the Action Center tabs', () => {
  it('stay Actions, Signals, KPIs and History, with Needs review, without SIMPLE_NAV', () => {
    expect(ACTION_CENTER_TABS.map((tab) => tab.key)).toEqual([
      'actions',
      'signals',
      'kpis',
      'history',
    ]);
    expect(REVIEW_TAB.href).toBe('/dashboard/action-center/review');
  });

  it('are Today, Actions, Signals, Agents and History with it, Agents at Agent Center’s address', () => {
    expect(SIMPLE_TABS.map((tab) => tab.key)).toEqual([
      'today',
      'actions',
      'signals',
      'agents',
      'history',
    ]);
    expect(SIMPLE_TABS[0].href).toBe(ACTION_CENTER_TODAY);
    expect(SIMPLE_TABS.find((tab) => tab.key === 'agents')?.href).toBe('/dashboard/agents');
  });
});

describe('simpleTabOf', () => {
  it('names the tab a page is under, the pages under it included', () => {
    expect(simpleTabOf('/dashboard/action-center/today')).toBe('today');
    expect(simpleTabOf('/dashboard/action-center/actions')).toBe('actions');
    expect(simpleTabOf('/dashboard/action-center/actions/AC-12')).toBe('actions');
    expect(simpleTabOf('/dashboard/action-center/signals')).toBe('signals');
    expect(simpleTabOf('/dashboard/agents')).toBe('agents');
    expect(simpleTabOf('/dashboard/agents/new')).toBe('agents');
    expect(simpleTabOf('/dashboard/agents/abc/edit')).toBe('agents');
    expect(simpleTabOf('/dashboard/action-center/history')).toBe('history');
  });

  it('shows History on KPIs, one of its views', () => {
    expect(simpleTabOf('/dashboard/action-center/kpis')).toBe('history');
  });

  it('shows none on Needs review or off the Action Center', () => {
    expect(simpleTabOf('/dashboard/action-center/review')).toBeNull();
    expect(simpleTabOf('/dashboard/agent')).toBeNull();
    expect(simpleTabOf('/dashboard/agentsx')).toBeNull();
    expect(simpleTabOf('/dashboard/insights')).toBeNull();
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
