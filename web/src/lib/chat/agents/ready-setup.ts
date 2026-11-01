import { NextResponse } from 'next/server';
import { PLANS } from '@/config/plans';
import { modeDenial } from '../agent-rules';
import { readAgentContext, type AgentContext } from '../agents';
import { planGateLock } from '../plan-facts';
import { chatActor } from '../run-api';
import { AGENT_PRESETS, FULL_AUTO_PLAN, presetGate, type PresetLock } from './catalog';

/**
 * What Agent Center's Ready to use cards say about the workspace's plan
 * (AGENTS plan §5): a ready preset whose mode the plan keeps closed shows
 * the plan it needs and the one the workspace is on, by planGateLock as
 * Chat's tools are gated; one an Admin turned off in Settings › Chat says
 * so. Plan names only, never a price. Server only: the plan facts hold the
 * AI budgets.
 */

export function presetLocksFor(
  ctx: Pick<AgentContext, 'plan' | 'settings' | 'viewer'>,
): Record<string, PresetLock> {
  const locks: Record<string, PresetLock> = {};
  for (const preset of AGENT_PRESETS) {
    if (preset.status !== 'ready') continue;
    const needs = planGateLock(ctx.plan, presetGate(preset));
    const denial = modeDenial(preset.mode, ctx.plan, ctx.settings, ctx.viewer.role);
    if (needs || denial?.denial.code === 'plan_locked') {
      locks[preset.id] = {
        kind: 'plan',
        plan: PLANS[needs ?? FULL_AUTO_PLAN].name,
        current: ctx.plan.planName,
      };
    } else if (denial) {
      locks[preset.id] = { kind: 'policy' };
    }
  }
  return locks;
}

/** The signed-in person's locks; none when they can't be read (New agent checks again). */
export async function readPresetLocks(): Promise<Record<string, PresetLock>> {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return {};
    const ctx = await readAgentContext(actor);
    return ctx ? presetLocksFor(ctx) : {};
  } catch (err) {
    console.error('[chat/agents] could not read the ready-to-use agents’ plan locks:', err);
    return {};
  }
}
