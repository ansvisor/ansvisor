import { asScoreRange } from '@/lib/audit/score-range';
import { isChatHref, type ChatAuditCard } from './events';

/**
 * A Site Audit's card in Chat (owner decision, after #2143): when a run reads
 * one audit in full (list_site_audit_issues), the audit shows under the
 * answer with its page, its score on the report's gauge with its range
 * ("64 ± 2"), when it ran, the change since the page's audit before, and
 * Open report. Every number is the read's own, never the model's: a range
 * the rule couldn't give, or one the score isn't in, isn't shown. Pure: the
 * engine emits the card, and the browser and a reloaded chat keep it alike.
 */

export const AUDIT_TOOL = 'list_site_audit_issues';

/** The most audit cards one answer shows: a run that reads more keeps the first ones. */
export const MAX_AUDIT_CARDS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const words = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A score as the audit gives it, 0–1; null for anything else. */
const scoreOf = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;

const points = (score: number) => Math.round(score * 100);

/**
 * The card of an audit read (getSiteAuditFor's result), or null when it has
 * nothing to show: an audit still running, failed or unscored, or a result
 * that isn't one. A partial audit shows its score with no range or change:
 * it isn't compared with the page's other audits.
 */
export function auditCard(value: unknown): ChatAuditCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const audit = value as Record<string, unknown>;
  const score = scoreOf(audit.totalScore);
  const page = words(audit.finalUrl) ?? words(audit.url);
  const href =
    typeof audit.id === 'string' && UUID.test(audit.id) ? `/dashboard/audit/${audit.id}` : '';
  const auditedAt = isDate(audit.completedAt)
    ? audit.completedAt
    : isDate(audit.createdAt)
      ? audit.createdAt
      : null;
  if (audit.status !== 'completed' || score === null || !page || !auditedAt) return null;
  if (!isChatHref(href)) return null;
  const partial = audit.partial === true;
  const range = partial ? null : asScoreRange(audit.scoreRange);
  const previous = partial ? null : scoreOf(audit.previousScore);
  return {
    page,
    score,
    // The score shown is one of the audits the range read: a range it isn't in isn't its range.
    range: range && points(score) >= range.low && points(score) <= range.high ? range : null,
    partial,
    auditedAt,
    change:
      previous !== null && isDate(audit.previousCreatedAt)
        ? { points: points(score) - points(previous), since: audit.previousCreatedAt }
        : null,
    href,
  };
}

/**
 * A run's audit cards after one more, in the order read: the same audit read
 * again keeps one card, the newer; past MAX_AUDIT_CARDS none is added.
 */
export function withAuditCard(
  cards: readonly ChatAuditCard[],
  card: ChatAuditCard,
): ChatAuditCard[] {
  const at = cards.findIndex((kept) => kept.href === card.href);
  if (at >= 0) return cards.map((kept, i) => (i === at ? card : kept));
  return cards.length >= MAX_AUDIT_CARDS ? [...cards] : [...cards, card];
}
