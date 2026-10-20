/**
 * Getting started (New Ansvisor, AC-ALT2 §4): the fixed steps a brand walks
 * through in the Actions page, and how each step's state follows from the
 * brand's data (getting_started_facts, 00196). They sit beside the generated
 * actions and never go through the signal engine or get a Priority Score.
 *
 * Steps unlock when their data is ready, not on a schedule:
 *   - Set up: now.
 *   - Explore: when the first AI answers are in. The high-value prompts step
 *     waits for prompt suggestions built from Search Console or Analytics.
 *   - Act: when the first content suggestions are in.
 *   - Ready: after every step above is done or skipped.
 */

export type GettingStartedStage = 'setup' | 'explore' | 'act' | 'ready';

export type GettingStartedStepKey =
  | 'kpis'
  | 'competitors'
  | 'topics'
  | 'prompts'
  | 'gsc'
  | 'ga'
  | 'snippet'
  | 'visibility'
  | 'answers'
  | 'data_prompts'
  | 'mentions'
  | 'citations'
  | 'traffic'
  | 'pick_content'
  | 'create_content'
  | 'optimize_page'
  | 'ready';

/** waiting: locked until its data is ready ("Waiting for data"). */
export type GettingStartedState = 'new' | 'done' | 'waiting' | 'skipped';

export interface GettingStartedStepDef {
  key: GettingStartedStepKey;
  stage: GettingStartedStage;
  /** The page the step opens, in a new tab. */
  href: string;
  /** Optional steps can be skipped; a skipped step counts as complete. */
  optional?: boolean;
}

const INTEGRATIONS_HREF = '/dashboard/settings?tab=integrations';

export const GETTING_STARTED_STEPS: readonly GettingStartedStepDef[] = [
  { key: 'kpis', stage: 'setup', href: '/dashboard/action-center/kpis' },
  { key: 'competitors', stage: 'setup', href: '/dashboard/competitors' },
  { key: 'topics', stage: 'setup', href: '/dashboard/prompts/topics' },
  { key: 'prompts', stage: 'setup', href: '/dashboard/prompts/suggestions' },
  { key: 'gsc', stage: 'setup', href: INTEGRATIONS_HREF, optional: true },
  { key: 'ga', stage: 'setup', href: INTEGRATIONS_HREF, optional: true },
  { key: 'snippet', stage: 'setup', href: '/dashboard/traffic' },
  { key: 'visibility', stage: 'explore', href: '/dashboard/insights' },
  { key: 'answers', stage: 'explore', href: '/dashboard/prompts/tracked' },
  { key: 'data_prompts', stage: 'explore', href: '/dashboard/prompts/suggestions' },
  { key: 'mentions', stage: 'explore', href: '/dashboard/mentions' },
  { key: 'citations', stage: 'explore', href: '/dashboard/citations' },
  { key: 'traffic', stage: 'explore', href: '/dashboard/traffic' },
  { key: 'pick_content', stage: 'act', href: '/dashboard/content' },
  { key: 'create_content', stage: 'act', href: '/dashboard/content' },
  { key: 'optimize_page', stage: 'act', href: '/dashboard/audit' },
  { key: 'ready', stage: 'ready', href: '/dashboard/action-center/actions' },
];

export const MIN_COMPETITORS = 3;
export const MIN_TOPICS = 3;
export const PROMPTS_PER_TOPIC = 3;
/** Search Console / Analytics prompt suggestions to track. */
export const DATA_PROMPTS_TARGET = 5;

/** The explore steps that are done once their page is opened. */
const PAGE_STEPS: readonly { path: string; step: GettingStartedStepKey }[] = [
  { path: '/dashboard/insights', step: 'visibility' },
  { path: '/dashboard/prompts/tracked', step: 'answers' },
  { path: '/dashboard/mentions', step: 'mentions' },
  { path: '/dashboard/citations', step: 'citations' },
  { path: '/dashboard/traffic', step: 'traffic' },
];

/** The explore step a dashboard path opens, if any (no locale prefix). */
export function pageOpenedStep(pathname: string): GettingStartedStepKey | null {
  // /dashboard/prompts shows the tracked prompts too.
  const path = pathname === '/dashboard/prompts' ? '/dashboard/prompts/tracked' : pathname;
  const hit = PAGE_STEPS.find((p) => path === p.path || path.startsWith(`${p.path}/`));
  return hit?.step ?? null;
}

export function isPageOpenedStep(step: string): step is GettingStartedStepKey {
  return PAGE_STEPS.some((p) => p.step === step);
}

export type GettingStartedRecord = 'opened' | 'skipped' | 'done';

export interface GettingStartedFacts {
  startedAt: string | null;
  dismissedAt: string | null;
  /** What a person did that leaves no other trace (getting_started_steps). */
  records: Partial<Record<string, GettingStartedRecord>>;
  /** When each record was made. */
  recordedAt: Partial<Record<string, string>>;
  kpiSetupAt: string | null;
  competitors: number;
  /** Active prompts in each active topic. */
  topicPrompts: number[];
  gsc: boolean;
  ga: boolean;
  firstAnswer: boolean;
  firstVisit: boolean;
  dataSuggestions: number;
  dataTracked: number;
  contentSuggestions: number;
  contentPicked: number;
  contentCreated: number;
  audits: number;
}

export interface GettingStartedProgress {
  value: number;
  target: number;
}

export interface GettingStartedStep extends GettingStartedStepDef {
  state: GettingStartedState;
  progress: GettingStartedProgress | null;
  /** When a person last acted on it here; null for a step its data finished. */
  updatedAt: string | null;
}

export interface GettingStartedStatus {
  /** Started for the brand and not skipped. */
  active: boolean;
  steps: GettingStartedStep[];
  /** Steps done or skipped. */
  done: number;
  total: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const RECORDS = new Set<string>(['opened', 'skipped', 'done']);

/** getting_started_facts' jsonb, or null for a brand the caller can't see. */
export function parseGettingStartedFacts(raw: unknown): GettingStartedFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const records: Partial<Record<string, GettingStartedRecord>> = {};
  const recordedAt: Partial<Record<string, string>> = {};
  if (r.steps && typeof r.steps === 'object') {
    for (const [step, value] of Object.entries(r.steps as Record<string, unknown>)) {
      const { state, at } = (value ?? {}) as { state?: unknown; at?: unknown };
      if (typeof state === 'string' && RECORDS.has(state)) {
        records[step] = state as GettingStartedRecord;
        const time = str(at);
        if (time) recordedAt[step] = time;
      }
    }
  }
  return {
    startedAt: str(r.started_at),
    dismissedAt: str(r.dismissed_at),
    records,
    recordedAt,
    kpiSetupAt: str(r.kpi_setup_at),
    competitors: num(r.competitors),
    topicPrompts: Array.isArray(r.topic_prompts) ? r.topic_prompts.map(num) : [],
    gsc: r.gsc === true,
    ga: r.ga === true,
    firstAnswer: r.first_answer === true,
    firstVisit: r.first_visit === true,
    dataSuggestions: num(r.data_suggestions),
    dataTracked: num(r.data_tracked),
    contentSuggestions: num(r.content_suggestions),
    contentPicked: num(r.content_picked),
    contentCreated: num(r.content_created),
    audits: num(r.audits),
  };
}

const progress = (value: number, target: number): GettingStartedProgress => ({
  value: Math.min(value, target),
  target,
});

/** done when finished, else waiting until its data is ready, else new. */
const stateOf = (finished: boolean, ready: boolean): GettingStartedState =>
  finished ? 'done' : ready ? 'new' : 'waiting';

/** An optional step: done when connected, skipped when a person skipped it. */
const optionalState = (finished: boolean, record: GettingStartedRecord | undefined) =>
  finished ? 'done' : record === 'skipped' ? 'skipped' : 'new';

function kpisSet(f: GettingStartedFacts): boolean {
  if (f.records.kpis === 'done') return true;
  // KPIs a brand had before it started count: an existing customer set them
  // up already. After the start, the ready-made set appears on a visit to
  // the KPI tab, so only saving from the KPI screen counts.
  if (!f.kpiSetupAt) return false;
  return !f.startedAt || Date.parse(f.kpiSetupAt) < Date.parse(f.startedAt);
}

function stepState(
  key: GettingStartedStepKey,
  f: GettingStartedFacts,
): Pick<GettingStartedStep, 'state' | 'progress'> {
  const topics = f.topicPrompts.length;
  switch (key) {
    case 'kpis':
      return { state: stateOf(kpisSet(f), true), progress: null };
    case 'competitors':
      return {
        state: stateOf(f.competitors >= MIN_COMPETITORS, true),
        progress: progress(f.competitors, MIN_COMPETITORS),
      };
    case 'topics':
      return {
        state: stateOf(topics >= MIN_TOPICS, true),
        progress: progress(topics, MIN_TOPICS),
      };
    case 'prompts': {
      // Three in every topic, and at least three topics' worth.
      const target = PROMPTS_PER_TOPIC * Math.max(topics, MIN_TOPICS);
      const value = f.topicPrompts.reduce((sum, n) => sum + Math.min(n, PROMPTS_PER_TOPIC), 0);
      return { state: stateOf(value >= target, true), progress: progress(value, target) };
    }
    case 'gsc':
      return { state: optionalState(f.gsc, f.records.gsc), progress: null };
    case 'ga':
      return { state: optionalState(f.ga, f.records.ga), progress: null };
    case 'snippet':
      return { state: stateOf(f.firstVisit, true), progress: null };
    case 'visibility':
    case 'answers':
    case 'mentions':
    case 'citations':
    case 'traffic':
      return { state: stateOf(Boolean(f.records[key]), f.firstAnswer), progress: null };
    case 'data_prompts': {
      const finished = f.dataTracked >= DATA_PROMPTS_TARGET;
      // With both sources skipped and neither connected, no such suggestion
      // can come: the step goes with them.
      const noSource = !f.gsc && !f.ga && f.records.gsc === 'skipped' && f.records.ga === 'skipped';
      return {
        state: !finished && noSource ? 'skipped' : stateOf(finished, f.dataSuggestions > 0),
        progress: progress(f.dataTracked, DATA_PROMPTS_TARGET),
      };
    }
    case 'pick_content':
      return { state: stateOf(f.contentPicked > 0, f.contentSuggestions > 0), progress: null };
    case 'create_content':
      return { state: stateOf(f.contentCreated > 0, f.contentSuggestions > 0), progress: null };
    case 'optimize_page':
      return { state: stateOf(f.audits > 0, f.contentSuggestions > 0), progress: null };
    case 'ready':
      // Filled in once the others are known.
      return { state: 'waiting', progress: null };
  }
}

const complete = (s: GettingStartedStep) => s.state === 'done' || s.state === 'skipped';

export function buildGettingStarted(f: GettingStartedFacts): GettingStartedStatus {
  const steps = GETTING_STARTED_STEPS.map((def) => ({
    ...def,
    ...stepState(def.key, f),
    updatedAt: f.recordedAt[def.key] ?? null,
  }));
  const ready = steps.find((s) => s.key === 'ready')!;
  ready.state = steps.every((s) => s === ready || complete(s)) ? 'done' : 'waiting';
  return {
    active: Boolean(f.startedAt) && !f.dismissedAt,
    steps,
    done: steps.filter(complete).length,
    total: steps.length,
  };
}
