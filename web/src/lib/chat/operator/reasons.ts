import { z } from 'zod';
import { ACTION_CATEGORIES } from '@/lib/action-center/registry';
import { KPI_KEYS } from '@/lib/kpis/registry';
import { SIGNAL_CATEGORIES } from '@/lib/signals/registry';

/**
 * Why the AEO Operator picks an agent (AEO Operator plan §4.1, §4.2 step 2):
 * a code and its numbers, the categories and KPIs from the app's own lists.
 * Never text: the child's message, the plan's card and the Operator's page
 * word them. A plain module, so the browser's pages read the same codes as
 * the server (agent-children.ts re-exports them). Pure.
 */

/** Reasons one child's evidence, or one plan item, keeps at most. */
export const MAX_REASONS = 10;

const count = z.number().int().min(0).max(1_000_000);
const days = z.number().int().min(0).max(3650);

const reasonSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('focus'), count }),
  z.object({ code: z.literal('open_actions'), category: z.enum(ACTION_CATEGORIES), count }),
  z.object({ code: z.literal('new_signals'), category: z.enum(SIGNAL_CATEGORIES), count }),
  z.object({ code: z.literal('kpi_off_track'), kpi: z.enum(KPI_KEYS) }),
  z.object({ code: z.literal('overdue'), days }),
  z.object({ code: z.literal('improved'), count }),
  z.object({ code: z.literal('declined'), count }),
  z.object({ code: z.literal('last_ran'), days }),
  z.object({ code: z.literal('never_ran') }),
]);
export type OperatorReason = z.infer<typeof reasonSchema>;

/** Reasons as stored, read defensively: what doesn't read as a known code is left out. */
export function operatorReasonsOf(json: unknown): OperatorReason[] {
  if (!Array.isArray(json)) return [];
  return json
    .flatMap((raw) => {
      const parsed = reasonSchema.safeParse(typeof raw === 'string' ? { code: raw } : raw);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_REASONS);
}

/** The work reasons an item shows at most beside when it last ran. */
const SHOWN_WORK = 2;
const LAST_RAN: readonly OperatorReason['code'][] = ['last_ran', 'never_ran'];
const OUTCOMES: readonly OperatorReason['code'][] = ['improved', 'declined'];

/**
 * The reasons a plan item shows, in order: its first reasons of work
 * (focus, open actions, signals, KPIs, overdue), then when it last ran. The
 * card's line and the Operator's Today panel show the same ones.
 */
export function shownReasons(reasons: readonly OperatorReason[]): OperatorReason[] {
  const work = reasons.filter(
    (reason) => !LAST_RAN.includes(reason.code) && !OUTCOMES.includes(reason.code),
  );
  const ran = reasons.find((reason) => LAST_RAN.includes(reason.code));
  return [...work.slice(0, SHOWN_WORK), ...(ran ? [ran] : [])];
}
