import type { ActionItem } from '@/lib/actions/action-center';
import { isActionKind } from '@/lib/action-center/registry';

/**
 * Composes what an action row shows from `kind` + `payload`, mirroring the
 * signals display helper: templates live in i18n
 * (actionCenter.actionTexts.<kind>), this module prepares the values and
 * picks the right variant when a payload part is optional.
 *
 * The server can raise a kind this build has never heard of — that is the
 * point of the definition registry, which grows on its own release cycle.
 * Such an action is presented generically rather than hidden: the work is
 * real, and a row nobody can read is still better than a row nobody sees.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function num(payload: Record<string, unknown>, key: string): number {
  return Number(payload[key] ?? 0);
}

/**
 * `expand_platform_visibility` → "Expand platform visibility".
 *
 * Definition ids are written to be read — they are verb phrases naming the
 * work — so the id itself is a better title than any generic string.
 */
export function humanizeKind(kind: string): string {
  const words = kind.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * "11 prompts", "6 sources" — how many of what an action is about.
 *
 * Every payload carries `targetEntity` and `targetCount` (server
 * definitions/_helpers.js). An action raised before the library existed has
 * neither, and gets its title without a count rather than "0 prompts".
 */
export function targetLabel(payload: Record<string, unknown>, t: Translator): string {
  const count = num(payload, 'targetCount');
  const entity = str(payload, 'targetEntity');
  return count > 0 && entity ? t(`targets.${entity}`, { count }) : '';
}

/**
 * An action's title and description.
 *
 * One path for all sixty-two definitions: the specification asks for titles
 * that name their targets — "Recover 7 lost citations", never "Recover
 * citations" — and every definition's payload now says what its targets are.
 * A kind this build has no copy for is still shown, from its id: the server's
 * registry grows on its own release cycle, and a row nobody can read beats a
 * row nobody sees.
 */
export function actionTexts(
  action: Pick<ActionItem, 'kind' | 'payload'>,
  t: Translator,
): { title: string; description: string } {
  const p = action.payload ?? {};
  if (!isActionKind(action.kind)) {
    return { title: humanizeKind(action.kind), description: t('unknown.description') };
  }
  const targets = targetLabel(p, t);
  return {
    title: targets ? t(`${action.kind}.title`, { targets }) : t(`${action.kind}.titleGeneric`),
    description: t(`${action.kind}.description`),
  };
}

/**
 * A task named inside an event message.
 *
 * Events carry the task's key, not its text, because an event is a record of
 * what happened and the text is a rendering choice that may change. Falls back
 * to a humanised key so an event about a task this build has no copy for still
 * reads as a sentence.
 */
export function eventTaskText(
  key: unknown,
  t: Translator & { has?: (key: string) => boolean },
): string {
  if (typeof key !== 'string' || key.length === 0) return '';
  if (t.has && !t.has(key)) return humanizeKind(key).toLowerCase();
  return t(key);
}

/**
 * What the drawer shows under "Goal".
 *
 * Its own helper rather than an inline `t(`${kind}.goal`)` in two components,
 * because an unknown kind has no goal key and next-intl would render the key
 * itself into the drawer.
 */
export function actionGoal(kind: string, t: Translator): string {
  return isActionKind(kind) ? t(`${kind}.goal`) : t('unknown.goal');
}

/** Compact evidence chips under the title: signal count plus the kind's own
 *  count (pages, prompts, competitors). */
export function actionContextTags(action: ActionItem, t: Translator): string[] {
  const tags = [t('tags.signals', { count: action.signalCount })];
  const count = num(action.payload ?? {}, 'targetCount');
  const entity = str(action.payload ?? {}, 'targetEntity');
  if (count > 0 && entity) tags.push(t(`tags.${entity}`, { count }));
  return tags;
}

const IMPACT_RANK: Record<ActionItem['impact'], number> = { high: 3, medium: 2, low: 1 };

/** Priority: impact first, then weight of evidence, then recency. The
 *  scoring formula stays out of the UI per the brief — this order IS it. */
export function comparePriority(a: ActionItem, b: ActionItem): number {
  return (
    IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
    b.signalCount - a.signalCount ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

/**
 * How a team member is named in an assignee picker.
 *
 * `full_name` is optional on a profile and most of this organization's members
 * have never set one, so the previous fallback — the first eight characters of
 * the user's uuid — put strings like `1d3fb0a2` in the dropdown. Email is the
 * one identifier every member is guaranteed to have and to recognise, which is
 * what the team settings list has always shown.
 */
export function memberLabel(member: { fullName: string | null; email: string }): string {
  return member.fullName?.trim() || member.email;
}

/**
 * A task's text: what the user wrote, or the template it was generated from.
 *
 * Generated tasks carry a `task_key` into actionCenter.actionTasks and no
 * title. Adding or renaming a task writes a title, which wins from then on —
 * the key stays behind so which template a task grew from is still answerable.
 */
export function taskText(
  task: {
    taskKey: string | null;
    title: string | null;
    titleParams?: Record<string, string | number>;
  },
  t: Translator,
): string {
  const title = task.title?.trim();
  if (title) return title;
  if (!task.taskKey) return '';

  // A planned task that knows what it acts on carries the values as
  // parameters and is rendered from the `_target` variant of its message:
  // "Analyze citations across 11 sources" rather than "Analyze citations".
  // Library tasks name a count and an entity, rendered here in the reader's
  // language; the original tasks name their own fields.
  const params = { ...(task.titleParams ?? {}) };
  if (params.count && params.entity) {
    params.targets = t(`targets.${params.entity}`, { count: Number(params.count) });
  }
  return Object.keys(params).length > 0 ? t(`${task.taskKey}_target`, params) : t(task.taskKey);
}
