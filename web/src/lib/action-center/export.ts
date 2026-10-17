import type { ActionDetail, ActionItem } from '@/lib/actions/action-center';
import { toCsv } from '@/lib/csv';
import { locationName, platformName } from '@/lib/signals/names';
import { dayIn } from '@/lib/time-zone';
import type { Sheet } from 'write-excel-file/browser';

/**
 * One action, whole, to take out of the app (AC-005): Markdown for the
 * clipboard ("Copy all"), a CSV with a `section` column, and an Excel
 * workbook with a sheet per section.
 *
 * The drawer first resolves every label in the reader's language into an
 * `ActionExport`, with what each of its tabs shows; the formats below only lay
 * it out, so the three always say the same thing.
 */

/** A labelled fact; a list is shown as one, a single value inline. */
export interface ExportFact {
  label: string;
  value: string | string[];
}

export interface ActionExport {
  /** "AC-52". */
  ref: string;
  title: string;
  category: string;
  impact: string;
  status: string;
  /** Empty when no one is assigned. */
  assignee: string;
  /** `YYYY-MM-DD`, or empty. */
  dueDate: string;
  /** The chips under the title ("Compete", "1 platform"). */
  tags: string[];
  why: string;
  goal: string;
  /** "AI Visibility (target 40)". */
  kpis: string[];
  /**
   * What the action was sent from, when a person sent it: the Improve tab's
   * prompt and platforms, a content opportunity's pages, brief and prompts.
   */
  context: ExportFact[];
  created: string;
  updated: string;
  /** The action's drawer in the app. */
  link: string;
  tasks: ExportTask[];
  signals: ExportSignal[];
  /** The History tab, in its order. */
  events: { date: string; text: string }[];
}

export interface ExportTask {
  number: number;
  title: string;
  status: string;
  /** What the task carries beyond its title, and why it was skipped. */
  details: string;
}

export interface ExportSignal {
  /** "Citation · Lost", as the signals list's Type column. */
  type: string;
  /** What it is about, as the Affected column: a prompt, a page, "3 prompts". */
  entity: string;
  title: string;
  description: string;
  category: string;
  status: string;
  impact: string;
  /** Display names, most common first. */
  platforms: string[];
  locations: string[];
  /** `YYYY-MM-DD`. */
  detected: string;
  lastDetected: string;
  /** The signal's drawer in the app. */
  link: string;
}

/** The labels an `ActionExport` is built from, each already in the reader's language. */
export interface ExportTexts {
  title: string;
  why: string;
  goal: string;
  category: string;
  impact: string;
  status: string;
  tags: string[];
  kpis: string[];
  context: ExportFact[];
  taskTitle: (task: ActionDetail['tasks'][number]) => string;
  taskStatus: (status: string) => string;
  signal: (signal: ActionDetail['signals'][number]) => {
    type: string;
    entity: string;
    title: string;
    description: string;
    category: string;
    status: string;
    impact: string;
  };
  event: (event: ActionDetail['events'][number]) => string;
  /** "Skipped: {reason}". */
  skipped: (reason: string) => string;
  /** What an AI answer a task rests on is called; its id means nothing outside. */
  answerSource: string;
}

/**
 * `YYYY-MM-DD` in the reader's time zone, as the app shows dates. A date
 * without a time (a due date) is already the day.
 */
function dayOf(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : dayIn(iso, timeZone);
}

/** The action and its detail, labelled, in the order the drawer shows them. */
export function buildActionExport(
  action: ActionItem,
  detail: ActionDetail,
  texts: ExportTexts,
  { origin, timeZone }: { origin: string; timeZone: string },
): ActionExport {
  const day = (iso: string | null | undefined) => dayOf(iso, timeZone);
  return {
    ref: `AC-${action.actionNo}`,
    title: texts.title,
    category: texts.category,
    impact: texts.impact,
    status: texts.status,
    assignee: action.assignee?.fullName?.trim() ?? '',
    dueDate: day(action.dueDate),
    tags: texts.tags,
    why: texts.why,
    goal: texts.goal,
    kpis: texts.kpis,
    context: texts.context,
    created: day(action.createdAt),
    updated: day(action.updatedAt),
    link: `${origin}/dashboard/action-center/actions?action=${action.id}`,
    tasks: detail.tasks.map((task, i) => {
      const details = task.details
        ? [
            task.details.body,
            task.details.platformLabel,
            ...task.details.sources.map((source) =>
              source.type === 'answer' ? texts.answerSource : source.ref,
            ),
          ]
        : [];
      if (task.skipReason) details.push(texts.skipped(task.skipReason));
      return {
        number: i + 1,
        title: texts.taskTitle(task),
        status: texts.taskStatus(task.status),
        details: details
          .filter(Boolean)
          .map((part) => part.replace(/\s*\n+\s*/g, ' '))
          .join(' · '),
      };
    }),
    signals: detail.signals.map((signal) => ({
      ...texts.signal(signal),
      platforms: signal.where.platforms.map(platformName),
      locations: signal.where.regions.map(locationName),
      detected: day(signal.detectedAt),
      lastDetected: day(signal.lastDetectedAt),
      link: `${origin}/dashboard/action-center/signals?signal=${signal.id}`,
    })),
    events: detail.events.map((event) => ({
      date: day(event.createdAt),
      text: texts.event(event),
    })),
  };
}

/** Headings and field names, in the reader's language (actionsPage.export). */
type Labels = (key: string, values?: Record<string, string | number>) => string;

const listed = (value: string | string[]) => (Array.isArray(value) ? value.join('; ') : value);

/** One line per signal: what, where, when, about what. */
function signalLine(signal: ExportSignal): string {
  return [
    signal.type,
    signal.platforms.join(', '),
    signal.locations.join(', '),
    signal.detected,
    signal.entity,
    signal.status,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * "Copy all": the action as Markdown, everything its drawer's tabs show, to
 * paste into Docs, Notion, Jira or an AI agent.
 */
export function actionMarkdown(a: ActionExport, label: Labels): string {
  const facts = (pairs: [string, string][]) =>
    pairs
      .filter(([, value]) => value)
      .map(([key, value]) => `${label(key)}: ${value}`)
      .join(' · ');
  const lines = [
    `# ${a.title} (${a.ref})`,
    facts([
      ['category', a.category],
      ['impact', a.impact],
      ['status', a.status],
    ]),
    facts([
      ['assignee', a.assignee],
      ['dueDate', a.dueDate],
    ]),
    a.tags.length ? `${label('tags')}: ${a.tags.join(', ')}` : '',
    `${label('why')}: ${a.why}`,
    `${label('goal')}: ${a.goal}`,
    a.kpis.length ? `${label('kpis')}: ${a.kpis.join(', ')}` : '',
    ...a.context.flatMap(({ label: name, value }) =>
      Array.isArray(value)
        ? [`${name}:`, ...value.map((item) => `- ${item}`)]
        : [`${name}: ${value}`],
    ),
    `${label('link')}: ${a.link}`,
  ].filter(Boolean);

  lines.push('', `## ${label('tasksHeading', { count: a.tasks.length })}`);
  for (const task of a.tasks) {
    lines.push(`${task.number}. ${task.title} (${task.status})`);
    if (task.details) lines.push(`   ${task.details}`);
  }

  lines.push('', `## ${label('signalsHeading', { count: a.signals.length })}`);
  for (const signal of a.signals) lines.push(`- ${signalLine(signal)}`);

  if (a.events.length) {
    lines.push('', `## ${label('historyHeading', { count: a.events.length })}`);
    for (const event of a.events) lines.push(`- ${event.date} · ${event.text}`);
  }

  return lines.join('\n');
}

/**
 * The CSV columns: a row per task and per signal, marked by `section`, with
 * the columns they share. Machine names, as in the actions list's export.
 */
export const ACTION_CSV_HEADERS = [
  'section',
  'action',
  'ref',
  'title',
  'type',
  'entity',
  'details',
  'status',
  'category',
  'impact',
  'platforms',
  'locations',
  'first_detected',
  'last_detected',
  'link',
];

/** "Export CSV": the action's tasks and signals, one row each. */
export function actionCsv(a: ActionExport): string {
  const rows: Record<string, unknown>[] = [
    ...a.tasks.map((task) => ({
      section: 'task',
      action: a.ref,
      ref: task.number,
      title: task.title,
      details: task.details,
      status: task.status,
      link: a.link,
    })),
    ...a.signals.map((signal, i) => ({
      section: 'signal',
      action: a.ref,
      ref: i + 1,
      title: signal.title,
      type: signal.type,
      entity: signal.entity,
      details: signal.description,
      status: signal.status,
      category: signal.category,
      impact: signal.impact,
      platforms: signal.platforms.join('; '),
      locations: signal.locations.join('; '),
      first_detected: signal.detected,
      last_detected: signal.lastDetected,
      link: signal.link,
    })),
  ];
  return toCsv(rows, ACTION_CSV_HEADERS);
}

const bold = (value: string) => ({ value, fontWeight: 'bold' as const });

/** "Export Excel": a sheet each for the action, its tasks, its signals and its history. */
export function actionWorkbook(a: ActionExport, label: Labels): Sheet<Blob>[] {
  const summary: [string, string][] = [
    [label('action'), a.ref],
    [label('title'), a.title],
    [label('category'), a.category],
    [label('impact'), a.impact],
    [label('status'), a.status],
    [label('assignee'), a.assignee],
    [label('dueDate'), a.dueDate],
    [label('tags'), a.tags.join(', ')],
    [label('why'), a.why],
    [label('goal'), a.goal],
    [label('kpis'), a.kpis.join(', ')],
    ...a.context.map(({ label: name, value }): [string, string] => [name, listed(value)]),
    [label('created'), a.created],
    [label('updated'), a.updated],
    [label('link'), a.link],
  ];
  return [
    {
      sheet: label('sheets.action'),
      columns: [{ width: 22 }, { width: 90 }],
      data: summary.map(([name, value]) => [bold(name), value]),
    },
    {
      sheet: label('sheets.tasks'),
      stickyRowsCount: 1,
      columns: [{ width: 5 }, { width: 60 }, { width: 14 }, { width: 70 }],
      data: [
        ['#', label('task'), label('status'), label('details')].map(bold),
        ...a.tasks.map((task) => [task.number, task.title, task.status, task.details]),
      ],
    },
    {
      sheet: label('sheets.signals'),
      stickyRowsCount: 1,
      columns: [
        { width: 22 },
        { width: 40 },
        { width: 50 },
        { width: 60 },
        { width: 12 },
        { width: 10 },
        { width: 24 },
        { width: 16 },
        { width: 14 },
        { width: 14 },
        { width: 40 },
      ],
      data: [
        [
          label('type'),
          label('entity'),
          label('signal'),
          label('description'),
          label('status'),
          label('impact'),
          label('platforms'),
          label('locations'),
          label('firstDetected'),
          label('lastDetected'),
          label('link'),
        ].map(bold),
        ...a.signals.map((signal) => [
          signal.type,
          signal.entity,
          signal.title,
          signal.description,
          signal.status,
          signal.impact,
          signal.platforms.join(', '),
          signal.locations.join(', '),
          signal.detected,
          signal.lastDetected,
          signal.link,
        ]),
      ],
    },
    {
      sheet: label('sheets.history'),
      stickyRowsCount: 1,
      columns: [{ width: 14 }, { width: 90 }],
      data: [
        [label('date'), label('event')].map(bold),
        ...a.events.map((event) => [event.date, event.text]),
      ],
    },
  ];
}

/** `action-AC-52.csv`, as the spec names it. */
export function actionExportFileName(a: ActionExport, extension: 'csv' | 'xlsx') {
  return `action-${a.ref}.${extension}`;
}
