'use client';

import { MenuDot } from '@/components/layout/menu-dot';
import type { AgentListItem } from '@/lib/chat/agents';
import type { ScheduleListItem } from '@/lib/chat/schedule/views';
import type { RowDot } from '@/lib/menu-dots';

/**
 * A run's dot on Action Center › Agents' cards, in the menu's dots
 * (menu-dots.ts): grey and pulsing while it runs, yellow while it waits for
 * the person's OK, red once it failed. A run that finished has none: no
 * marker says whether the person opened its results since, so no green.
 */
function runDotOf(status: string): RowDot | null {
  switch (status) {
    case 'queued':
    case 'running':
      return { colour: 'grey', reason: 'agentWorking' };
    case 'needs_you':
      return { colour: 'yellow', reason: 'agentNeedsOk' };
    case 'failed':
      return { colour: 'red', reason: 'agentRunFailed' };
    default:
      return null;
  }
}

/** An agent's (Your agents): its newest run's dot while it is on; none paused, a draft or archived. */
export function agentDotOf(agent: Pick<AgentListItem, 'status' | 'lastRun'>): RowDot | null {
  if (agent.status !== 'active' || !agent.lastRun) return null;
  return runDotOf(agent.lastRun.status);
}

/** A job's made in Chat: its newest run's dot while it is on; none while paused. */
export function jobDotOf(job: Pick<ScheduleListItem, 'enabled' | 'lastRun'>): RowDot | null {
  if (!job.enabled || !job.lastRun) return null;
  return runDotOf(job.lastRun.status);
}

/** The card's dot, or nothing. */
export function AgentDot({ dot, className }: { dot: RowDot | null; className?: string }) {
  return dot ? <MenuDot dot={dot} className={className} /> : null;
}
