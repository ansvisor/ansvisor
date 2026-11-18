import { ACTION_CATEGORIES, type ActionCategory } from '@/lib/action-center/registry';
import { KPI_KEYS, type KpiKey } from '@/lib/kpis/registry';
import { SIGNAL_CATEGORIES, type SignalCategory } from '@/lib/signals/registry';

/**
 * Which agent fits which work (AEO Operator plan §4.2 "Which agent does
 * what"): the Action Center categories (growth, protect, recover, fix,
 * compete), the signal categories (visibility, citation, mention, traffic,
 * technical, competitor) and the KPIs an agent serves, from its skills, the
 * categories of its own Signal triggers and the KPIs of its KPI triggers.
 * The planner (plan.ts) counts only the work an agent fits.
 *
 * Every skill of the library (the repo's /skills folder, library.json's
 * skills and playbooks, and the presets' skills) is either mapped here or
 * left out on purpose, with why (fit.test.ts keeps the two lists in step
 * with the library). A skill with no clear fit maps to nothing rather than
 * to a guess: an agent made of it is picked only by its own triggers, or
 * when it is overdue against its schedule. A workspace's own skills map to
 * nothing. Pure.
 */

/** The work one skill serves. */
export interface SkillFit {
  actions: readonly ActionCategory[];
  signals: readonly SignalCategory[];
  kpis: readonly KpiKey[];
  /** Today's focus counts for it whatever the action's category (/tasks). */
  focus?: true;
}

/** The work an agent serves: its skills' and its triggers', each once, in the registries' order. */
export interface AgentFit {
  actions: readonly ActionCategory[];
  signals: readonly SignalCategory[];
  kpis: readonly KpiKey[];
  focus: boolean;
}

const RECOVER_CITATIONS: SkillFit = {
  actions: ['recover'],
  signals: ['citation'],
  kpis: ['citations'],
};
const COMPETE: SkillFit = {
  actions: ['compete'],
  signals: ['competitor'],
  kpis: ['share_of_voice'],
};
const PROTECT: SkillFit = {
  actions: ['protect'],
  signals: ['mention'],
  kpis: ['positive_sentiment'],
};
const FIX: SkillFit = { actions: ['fix'], signals: ['technical'], kpis: [] };
const GROWTH: SkillFit = { actions: ['growth'], signals: ['visibility'], kpis: ['ai_visibility'] };

/** The skills that serve work, by id (the plan's examples, and the clear fits besides). */
export const SKILL_FIT: Readonly<Record<string, SkillFit>> = Object.freeze({
  // Win back lost citations.
  winback: RECOVER_CITATIONS,
  // Against competitors: their pages, a comparison, a rival's brief, who wins by market.
  beat: COMPETE,
  compare: COMPETE,
  rivals: COMPETE,
  markets: COMPETE,
  // What AI says about the brand stays right and current.
  refresh: PROTECT,
  wrongclaim: PROTECT,
  facts: PROTECT,
  // Not one of the plan's examples: wrongclaim's and facts' check, for ChatGPT's answers.
  'chatgpt-profile': PROTECT,
  // Site audit findings.
  'audit-fix': FIX,
  // New answers and pages for prompts and questions where the brand isn't seen.
  faq: GROWTH,
  fanout: GROWTH,
  answerfirst: GROWTH,
  questions: GROWTH,
  features: GROWTH,
  gaps: GROWTH,
  'content-plan': GROWTH,
  prompts: GROWTH,
  // Not one of the plan's examples: getting listed on the sources AI cites (earn third-party citations).
  listings: { actions: ['growth'], signals: ['citation'], kpis: ['citations'] },
  // Works through Action Center by priority: every category, and today's focus.
  tasks: { actions: [...ACTION_CATEGORIES], signals: [], kpis: [], focus: true },
});

/** Why a skill serves no work the Operator counts. */
export type UnmappedReason =
  /** It reports; it has no work of its own to pick it for. */
  | 'report'
  /** It checks or sends drafts other work made. */
  | 'draft_check'
  /** It plans the work (adds actions) rather than doing it. */
  | 'planning'
  /** A new workspace's or brand's setup. */
  | 'onboarding'
  /** It works ahead of the calendar's seasons, not on actions or signals. */
  | 'calendar'
  /** Ads (behind their own flag): no action, signal or KPI of theirs yet. */
  | 'ads'
  /** A shortcut's playbook (library.json `playbooks`): never an agent's skill. */
  | 'playbook'
  /** The AEO coach for Claude clients on the MCP server, not Chat's. */
  | 'mcp_coach'
  /** The Operator's own skill (PR 4): it is never a candidate. */
  | 'operator'
  /** Its work is real but no category, signal or KPI says it. */
  | 'no_clear_fit';

/** The library's skills left out on purpose, with why. */
export const UNMAPPED_SKILLS: Readonly<Record<string, UnmappedReason>> = Object.freeze({
  report: 'report',
  traffic: 'report',
  'ai-revenue': 'report',
  quality: 'draft_check',
  publish: 'draft_check',
  plan: 'planning',
  setup: 'onboarding',
  seasonal: 'calendar',
  'earn-or-pay': 'ads',
  'ad-drafts': 'ads',
  shopping: 'no_clear_fit',
  translate: 'no_clear_fit',
  start: 'playbook',
  analyze: 'playbook',
  'new-report': 'playbook',
  create: 'playbook',
  optimize: 'playbook',
  opportunities: 'playbook',
  audit: 'playbook',
  image: 'playbook',
  'ansvisor-aeo-coach': 'mcp_coach',
  'ansvisor-aeo-coach-standalone': 'mcp_coach',
  operator: 'operator',
});

/** One skill's fit, or null for one that serves none (unmapped, or a workspace's own). */
export function skillFit(id: string): SkillFit | null {
  return Object.hasOwn(SKILL_FIT, id) ? SKILL_FIT[id] : null;
}

const inOrder = <T extends string>(order: readonly T[], wanted: ReadonlySet<string>): T[] =>
  order.filter((value) => wanted.has(value));

/**
 * What an agent serves: its skills' fits, the Action Center categories of
 * its own Signal triggers (a Signal trigger's `category` is one) and the
 * KPIs of its KPI triggers. Values outside the registries are left out.
 */
export function agentFit(agent: {
  skills: readonly string[];
  signalTriggerCategories: readonly string[];
  kpiTriggers: readonly string[];
}): AgentFit {
  const actions = new Set<string>(agent.signalTriggerCategories);
  const signals = new Set<string>();
  const kpis = new Set<string>(agent.kpiTriggers);
  let focus = false;
  for (const id of agent.skills) {
    const fit = skillFit(id);
    if (!fit) continue;
    fit.actions.forEach((category) => actions.add(category));
    fit.signals.forEach((category) => signals.add(category));
    fit.kpis.forEach((kpi) => kpis.add(kpi));
    if (fit.focus) focus = true;
  }
  return {
    actions: inOrder(ACTION_CATEGORIES, actions),
    signals: inOrder(SIGNAL_CATEGORIES, signals),
    kpis: inOrder(KPI_KEYS, kpis),
    focus,
  };
}
