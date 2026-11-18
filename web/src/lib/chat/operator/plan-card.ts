import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { operatorReasonWords } from '../agent-children';
import type { ToolCardDetails } from '../registry/define-tool';
import { readPlan, type PlanView, type StoredPlanItem } from './plan-store';
import { shownReasons } from './reasons';

/**
 * The AEO Operator's plan card (AEO Operator plan §4.2 step 5), built from
 * the plan's row, never from what the model wrote: its input is the plan's
 * id and brand. The card lists each agent by its name in the workspace, why
 * it runs today in words the code writes from the plan's codes, and what it
 * may cost; why these, the day's budget as the goal, and an AI use line.
 * The target (what Slack's message shows, as the step's line) names the
 * first two agents and how many more, and the budget. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.operator' });

/** The agents the target names before "+N". */
const TARGET_NAMES = 2;

/** A share of the monthly AI limit in words: "5%", "1.2%". */
export const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

/**
 * Why an agent runs today, in words: its first reasons of work (focus, open
 * actions, signals, KPIs, overdue), then when it last ran, then about what
 * it costs: "3 open Recover actions · last ran 9 days ago · about 1.2%".
 */
export function itemLine(item: Pick<StoredPlanItem, 'reasons' | 'cost'>): string {
  const reasons = shownReasons(item.reasons).map(operatorReasonWords).join(' · ');
  if (item.cost === null) return reasons;
  const cost = percent(item.cost);
  return reasons ? t('reasons', { reasons, cost }) : t('cost', { cost });
}

/** The plan's agents' names, by id, in its workspace: never another's. */
async function agentNames(organizationId: string, ids: readonly string[]) {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('id, name')
    .eq('organization_id', organizationId)
    .in('id', [...ids]);
  if (error) throw new Error(`Could not read the plan's agents: ${error.message}`);
  for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  return names;
}

/** The Operator's own daily budget (its max_run_share), and its brand's name. */
async function operatorFacts(plan: PlanView) {
  const [agent, brand] = await Promise.all([
    supabaseAdmin
      .from('chat_agents')
      .select('max_run_share')
      .eq('id', plan.agentId)
      .eq('organization_id', plan.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('brands')
      .select('name')
      .eq('id', plan.brandId)
      .eq('organization_id', plan.organizationId)
      .maybeSingle(),
  ]);
  if (agent.error) throw new Error(`Could not read the Operator: ${agent.error.message}`);
  if (brand.error) throw new Error(`Could not read the plan's brand: ${brand.error.message}`);
  const daily = Number((agent.data as { max_run_share?: unknown } | null)?.max_run_share);
  return {
    daily: Number.isFinite(daily) ? daily : null,
    brand: (brand.data as { name?: string } | null)?.name ?? '',
  };
}

/** The card's line: "Citation Win-back, Competitor Watch +3 · up to 5%". */
export function planTarget(plan: PlanView, names: ReadonlyMap<string, string>): string {
  const named = plan.items.map((item) => names.get(item.agent_id) ?? t('unknownAgent'));
  const shown = named.slice(0, TARGET_NAMES).join(', ');
  const listed =
    named.length > TARGET_NAMES
      ? t('more', { names: shown, count: named.length - TARGET_NAMES })
      : shown;
  return plan.budgetShare === null
    ? listed
    : t('target', { names: listed, budget: percent(plan.budgetShare) });
}

/** The plan's card, from its row (above). Null when the plan isn't the workspace's and brand's. */
export async function planCard(
  organizationId: string,
  planId: string,
  brandId: string,
): Promise<{ target: string; details: ToolCardDetails } | null> {
  const plan = await readPlan(organizationId, planId, brandId);
  if (!plan) return null;
  const [names, facts] = await Promise.all([
    agentNames(
      organizationId,
      plan.items.map((item) => item.agent_id),
    ),
    operatorFacts(plan),
  ]);
  const budget = plan.budgetShare;
  const goal =
    budget === null
      ? t('goalCount', { count: plan.items.length })
      : facts.daily !== null && budget < facts.daily - 1e-9
        ? t('goalPaced', { budget: percent(budget), daily: percent(facts.daily) })
        : t('goal', { budget: percent(budget) });
  const why = [
    t('why', { brand: facts.brand }),
    plan.passedCount > 0 ? t('waiting', { count: plan.passedCount }) : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    target: planTarget(plan, names),
    details: {
      items: plan.items.map((item) => ({
        title: names.get(item.agent_id) ?? t('unknownAgent'),
        detail: itemLine(item) || undefined,
      })),
      why,
      goal,
      ...(budget !== null
        ? {
            targets: [{ kind: 'aiUse' as const, values: [t('aiUse', { share: percent(budget) })] }],
          }
        : {}),
    },
  };
}
