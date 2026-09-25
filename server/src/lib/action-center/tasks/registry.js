/**
 * The task registry (#818, phase 5).
 *
 * Every action of a given kind got the same task list, inline in its
 * definition, regardless of what the brand actually has. Both specifications
 * rule that out: a plan should follow from the action's targets and the data
 * the workspace holds, not from the kind alone.
 *
 * So the task text stops being a string in a definition and becomes a
 * primitive with an identity. Each one declares:
 *
 *  - `requires` — the sources a brand needs before this task is worth
 *    planning. A task asking someone to read their analytics is noise for a
 *    brand with no analytics connected;
 *  - `mode` — who can carry it out. `agent` means the work is reading and
 *    reasoning over data we already hold, which is the half a tool could do;
 *    `manual` means it changes something we do not own — a page, a CMS, a
 *    relationship;
 *  - `permission` — whether carrying it out reaches outside Ansvisor. Nothing
 *    executes yet (phase 7), but the declaration is what phase 7 reads, and
 *    deciding it task by task now is safer than deciding it in a hurry later;
 *  - `dependsOn` — what must be finished first. Ordering was previously
 *    implied by array position and nothing enforced it;
 *  - `outputs` — the keys this task's result carries, so one task's finding
 *    can feed the next rather than living in someone's head.
 *
 * `version` belongs to the task, bumped when what it asks for changes. An
 * action's tasks record the version they were planned from, for the same
 * reason actions record their definition's.
 */

/** A brand source, as resolved by action-center/sources.js. */
const SOURCES = ['tracking', 'competitors', 'site_audits', 'analytics'];

/** Who carries the task out. */
export const MODES = Object.freeze(['manual', 'agent']);

/** Whether carrying it out reaches outside Ansvisor. */
export const PERMISSIONS = Object.freeze(['none', 'approval']);

const task = (id, spec) =>
  Object.freeze({
    id,
    version: 1,
    mode: 'manual',
    permission: 'none',
    ...spec,
    requires: Object.freeze(spec.requires ?? []),
    dependsOn: Object.freeze(spec.dependsOn ?? []),
    outputs: Object.freeze(spec.outputs ?? []),
    /** Payload keys whose values the task's text can name. When every one is
     *  present the planner stores them and the web renders the `_target`
     *  variant of the task's message; otherwise the plain one. */
    titleKeys: Object.freeze(spec.titleKeys ?? []),
  });

/**
 * Every task primitive, keyed by id. The id is what `action_tasks.task_key`
 * stores and what the web resolves its text from, so it is permanent.
 */
export const TASKS = Object.freeze({
  // ── Reading what happened ────────────────────────────────────────────────
  analyze_losses: task('analyze_losses', {
    mode: 'agent',
    titleKeys: ['promptCount'],
    outputs: ['lostPrompts', 'competitorSources'],
  }),
  diagnose_slip: task('diagnose_slip', { mode: 'agent', outputs: ['slippingPrompts'] }),
  review_responses: task('review_responses', {
    mode: 'agent',
    dependsOn: ['diagnose_slip'],
    outputs: ['weakAnswers'],
  }),
  review_pages: task('review_pages', {
    mode: 'agent',
    titleKeys: ['pageCount'],
    outputs: ['pages'],
  }),
  review_audits: task('review_audits', {
    mode: 'agent',
    requires: ['site_audits'],
    titleKeys: ['pageCount'],
    outputs: ['failingSignals'],
  }),
  identify_prompts: task('identify_prompts', {
    mode: 'agent',
    titleKeys: ['promptCount'],
    outputs: ['prompts'],
  }),
  compare_platforms: task('compare_platforms', {
    mode: 'agent',
    titleKeys: ['platform', 'bestPlatform'],
    outputs: ['platformRates'],
  }),
  compare_citations: task('compare_citations', {
    mode: 'agent',
    requires: ['competitors'],
    titleKeys: ['competitor'],
    outputs: ['competitorSources'],
  }),
  analyze_competitor: task('analyze_competitor', {
    mode: 'agent',
    requires: ['competitors'],
    titleKeys: ['competitor'],
    outputs: ['competitorPrompts'],
  }),
  coverage_gaps: task('coverage_gaps', { mode: 'agent', outputs: ['gaps'] }),
  identify_sources: task('identify_sources', {
    mode: 'agent',
    dependsOn: ['compare_citations'],
    outputs: ['sources'],
  }),

  // ── Reading what it cost, when the brand has the data to say ─────────────
  // The three tasks that exist only for a connected source. They are what
  // makes two brands' plans for the same action differ — see plan.js.
  measure_traffic_impact: task('measure_traffic_impact', {
    mode: 'agent',
    requires: ['analytics'],
    dependsOn: ['analyze_losses'],
    outputs: ['sessionsLost'],
  }),
  competitor_pressure: task('competitor_pressure', {
    mode: 'agent',
    requires: ['competitors'],
    dependsOn: ['diagnose_slip'],
    outputs: ['gainingCompetitors'],
  }),
  page_readiness: task('page_readiness', {
    mode: 'agent',
    requires: ['site_audits'],
    dependsOn: ['review_pages'],
    outputs: ['failingSignals'],
  }),

  // ── Changing something we do not own ─────────────────────────────────────
  update_content: task('update_content', { dependsOn: ['coverage_gaps'] }),
  optimize_content: task('optimize_content', { dependsOn: ['coverage_gaps'] }),
  reinforce_content: task('reinforce_content', { dependsOn: ['review_responses'] }),
  strengthen_content: task('strengthen_content', { dependsOn: ['coverage_gaps'] }),
  create_citable_content: task('create_citable_content', { dependsOn: ['identify_prompts'] }),
  internal_links: task('internal_links', { dependsOn: ['update_content'] }),
  fix_issues: task('fix_issues', { requires: ['site_audits'], dependsOn: ['review_audits'] }),

  // ── Reaching outside ─────────────────────────────────────────────────────
  // Manual today, but declared as needing approval: whoever makes this
  // executable in phase 7 should not have to decide that under deadline.
  strengthen_sources: task('strengthen_sources', {
    permission: 'approval',
    dependsOn: ['identify_sources'],
  }),

  // ── Checking whether it worked ───────────────────────────────────────────
  validate: task('validate', { mode: 'agent' }),
  revalidate: task('revalidate', { mode: 'agent', requires: ['site_audits'] }),
});

export function getTask(id) {
  return TASKS[id] ?? null;
}

export function listTasks() {
  return Object.values(TASKS);
}

/**
 * Everything a task must get right. Called by the registry's own test rather
 * than at import time: the registry is a literal in this file, so a mistake
 * is caught by CI, not by production starting up.
 */
export function validateTask(entry) {
  const problems = [];
  if (!entry.id || !/^[a-z][a-z0-9_]*$/.test(entry.id))
    problems.push('id must be lower_snake_case');
  if (!Number.isInteger(entry.version) || entry.version < 1) problems.push('version must be >= 1');
  if (!MODES.includes(entry.mode)) problems.push(`unknown mode "${entry.mode}"`);
  if (!PERMISSIONS.includes(entry.permission))
    problems.push(`unknown permission "${entry.permission}"`);
  for (const source of entry.requires) {
    if (!SOURCES.includes(source)) problems.push(`unknown source "${source}"`);
  }
  for (const dependency of entry.dependsOn) {
    if (!TASKS[dependency]) problems.push(`depends on unknown task "${dependency}"`);
  }
  return problems;
}
