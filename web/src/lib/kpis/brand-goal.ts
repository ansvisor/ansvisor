import { formatCompactNumber } from '@/lib/format';
import { KPI_REGISTRY, isKpiKey } from '@/lib/kpis/registry';

/**
 * A KPI's brand-wide monthly target as an action's drawer and its export
 * show it (UX audit AC-22, decision D11): in the KPI's unit, as the KPIs page
 * writes it ("21.4k", "15%"), and named for what it is, the brand's goal for
 * the month, not one scoped to the action's prompts.
 */
export function brandGoalText(kpiKey: string, target: number): string {
  if (isKpiKey(kpiKey) && KPI_REGISTRY[kpiKey].unit === 'percent') {
    return `${Math.round(target * 10) / 10}%`;
  }
  return formatCompactNumber(target);
}
