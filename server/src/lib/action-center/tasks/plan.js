/**
 * The task planner (#818, phase 5).
 *
 * Turns a definition's task spec into the rows one action actually gets,
 * given what the brand has and what the action is about. Two brands with the
 * same problem no longer receive the same list: a brand with analytics
 * connected is asked what the drop cost in sessions; a brand without is not
 * asked a question it cannot answer.
 *
 * Three things happen here, and nothing else — the planner decides the plan,
 * it does not write it. `generate.js` owns the writing, which keeps this
 * testable without a database.
 *
 *  1. **Eligibility.** A task whose required sources the brand lacks is
 *     dropped. Definition-level `requires` on a spec entry narrows further,
 *     which is how a task that exists for every brand can still be optional
 *     inside one particular plan.
 *  2. **Dependencies.** A dropped task takes its name out of everyone's
 *     `dependsOn`. A dependency that is not in the plan is not a dependency —
 *     leaving the name behind would block a task on work nobody was asked to
 *     do.
 *  3. **Targets.** A task that can name what it is about does, from the
 *     action's payload. The values travel as parameters rather than as
 *     resolved text, so the plan stays translatable.
 */

import { getTask } from './registry.js';

/**
 * Payload values a task's text may name, normalised.
 *
 * `competitorNames` is stored as a list because an action can consolidate
 * several; a task title names the one that leads. Everything else is passed
 * through as it was stored.
 */
function titleValues(payload) {
  const names = Array.isArray(payload.competitorNames) ? payload.competitorNames : [];
  return { ...payload, competitor: names[0] };
}

/** A spec entry is a bare task id, or an id with extra conditions. */
function normalise(entry) {
  return typeof entry === 'string' ? { id: entry, requires: [] } : { requires: [], ...entry };
}

/**
 * The tasks one action should be given.
 *
 * @param {{ id: string, tasks: readonly (string|object)[] }} definition
 * @param {{ sources: Set<string>, payload?: Record<string, unknown> }} context
 * @returns {Array<{ taskKey: string, version: number, mode: string, permission: string,
 *   dependsOn: string[], titleParams: Record<string, unknown>, position: number }>}
 */
export function planTasks(definition, { sources, payload = {} }) {
  const values = titleValues(payload);

  const chosen = [];
  for (const entry of definition.tasks.map(normalise)) {
    const primitive = getTask(entry.id);
    if (!primitive) continue;
    const needed = [...primitive.requires, ...entry.requires];
    if (!needed.every((source) => sources.has(source))) continue;
    chosen.push(primitive);
  }

  const planned = new Set(chosen.map((primitive) => primitive.id));

  return chosen.map((primitive, index) => {
    const named = primitive.titleKeys.every(
      (key) => values[key] !== undefined && values[key] !== null,
    );
    return {
      taskKey: primitive.id,
      version: primitive.version,
      mode: primitive.mode,
      permission: primitive.permission,
      dependsOn: primitive.dependsOn.filter((id) => planned.has(id)),
      titleParams: named
        ? Object.fromEntries(primitive.titleKeys.map((key) => [key, values[key]]))
        : {},
      position: index + 1,
    };
  });
}
