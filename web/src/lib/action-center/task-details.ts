/**
 * What a task carries beyond its title (AC-004): where to do it, why, how,
 * when it counts as done, what kind of work it is and what it takes.
 *
 * A task sent from the Improve tab (PROMPT-004) also carries its body,
 * platform and evidence; both shapes live in `action_tasks.details` and are
 * read through `parseTaskDetails`, so a row written by either, or by neither,
 * never breaks the drawer or the exports.
 */

/** The kinds of work a task can be (AC-004). */
export const TASK_TYPES = ['content', 'on_page', 'technical', 'outreach', 'pr', 'product'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface ActionTaskDetails {
  /** Improve (PROMPT-004): the suggestion as the user edited it. */
  body: string | null;
  platform: string | null;
  platformLabel: string | null;
  sources: { type: string; ref: string }[];
  /** The exact page, prompt, platform, domain or competitor. */
  where: string | null;
  /** The evidence from the action's signals. */
  why: string | null;
  /** The steps, in order. */
  how: string[];
  /** A measurable check. */
  doneWhen: string | null;
  type: TaskType | null;
  /** An estimate, e.g. "~2h". */
  effort: string | null;
  /** Who would do it, e.g. "Content writer". */
  role: string | null;
}

/** The fields a person edits in the drawer. */
export interface TaskDetailsEdit {
  where: string;
  why: string;
  how: string[];
  doneWhen: string;
  type: TaskType | null;
  effort: string;
  role: string;
}

/** How long each field may be. Steps are lines of one list. */
export const TASK_DETAIL_LIMITS = {
  where: 300,
  why: 600,
  step: 300,
  steps: 8,
  doneWhen: 300,
  effort: 40,
  role: 60,
} as const;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

/**
 * A task's details as stored, read defensively: any field may be missing or
 * of the wrong type. Null when there is nothing to show.
 */
export function parseTaskDetails(raw: unknown): ActionTaskDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const details: ActionTaskDetails = {
    body: text(r.body),
    platform: text(r.platform),
    platformLabel: text(r.platformLabel),
    sources: (Array.isArray(r.sources) ? r.sources : [])
      .map((source) => {
        const s = (source ?? {}) as Record<string, unknown>;
        return { type: text(s.type) ?? '', ref: text(s.ref) ?? '' };
      })
      .filter((source) => source.type && source.ref),
    where: text(r.where),
    why: text(r.why),
    how: (Array.isArray(r.how) ? r.how : [])
      .map(text)
      .filter((step): step is string => step !== null),
    doneWhen: text(r.doneWhen),
    type: isTaskType(r.type) ? r.type : null,
    effort: text(r.effort),
    role: text(r.role),
  };
  return hasTaskDetails(details) ? details : null;
}

/** Whether any field says something. */
export function hasTaskDetails(details: ActionTaskDetails): boolean {
  return (
    details.body !== null ||
    details.platformLabel !== null ||
    details.sources.length > 0 ||
    hasTaskSpec(details)
  );
}

/** Whether the AC-004 fields say something; the Improve ones aside. */
export function hasTaskSpec(details: ActionTaskDetails): boolean {
  return (
    details.where !== null ||
    details.why !== null ||
    details.how.length > 0 ||
    details.doneWhen !== null ||
    details.type !== null ||
    details.effort !== null ||
    details.role !== null
  );
}

const clip = (value: string, max: number): string | null => {
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed || null;
};

/**
 * Whether a value has an edit's shape. A server action takes whatever the
 * client sends, so the shape is checked before anything is read or written.
 */
export function isTaskDetailsEdit(value: unknown): value is TaskDetailsEdit {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const strings = ['where', 'why', 'doneWhen', 'effort', 'role'] as const;
  return (
    strings.every((key) => typeof v[key] === 'string') &&
    Array.isArray(v.how) &&
    v.how.every((step) => typeof step === 'string') &&
    (v.type === null || isTaskType(v.type))
  );
}

/**
 * An edit as it is stored: trimmed, cut to length, blank steps dropped and
 * the list capped. Empty fields are stored as null, so clearing a field
 * clears it.
 */
export function cleanTaskDetailsEdit(
  edit: TaskDetailsEdit,
): Pick<ActionTaskDetails, 'where' | 'why' | 'how' | 'doneWhen' | 'type' | 'effort' | 'role'> {
  return {
    where: clip(edit.where, TASK_DETAIL_LIMITS.where),
    why: clip(edit.why, TASK_DETAIL_LIMITS.why),
    how: edit.how
      .map((step) => clip(step, TASK_DETAIL_LIMITS.step))
      .filter((step): step is string => step !== null)
      .slice(0, TASK_DETAIL_LIMITS.steps),
    doneWhen: clip(edit.doneWhen, TASK_DETAIL_LIMITS.doneWhen),
    type: isTaskType(edit.type) ? edit.type : null,
    effort: clip(edit.effort, TASK_DETAIL_LIMITS.effort),
    role: clip(edit.role, TASK_DETAIL_LIMITS.role),
  };
}
