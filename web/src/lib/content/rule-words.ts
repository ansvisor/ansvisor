import { formatNumber } from '@/lib/format';
import type { RuleStatus } from './rules';

/**
 * A rule's status in the Rules tab's words (contentEditor.editor.rules.status),
 * for its badge, what the Content Agent is told, and Chat's check_draft_rules
 * (CHAT-25 §6, W4-12b part 2): one wording everywhere. Pure.
 */

/** How a rule reads now, as its badge says it ("✓", "3 found", "Missing"). */
export function ruleStatusText(
  t: (key: string, values?: Record<string, number>) => string,
  status: RuleStatus,
): string {
  if (status.state === 'ok') return '✓';
  if (status.code === 'partOf') return t('partOf', { count: status.count, of: status.of });
  if (status.code === 'current') return formatNumber(status.count);
  if ('count' in status) return t(status.code, { count: status.count });
  return t(status.code);
}

/**
 * The same in full, for the badge's hover and what the agent is told: a
 * length out of its band with the band ("15,921 characters, over 2,400–3,600").
 */
export function ruleStatusDetail(
  t: (key: string, values?: Record<string, number>) => string,
  status: RuleStatus,
): string {
  if (status.state === 'bad' && (status.code === 'short' || status.code === 'long')) {
    return t(`${status.code}Detail`, { count: status.count, min: status.min, max: status.max });
  }
  return ruleStatusText(t, status);
}
