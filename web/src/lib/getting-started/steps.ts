/**
 * Getting started: the 7 set-up steps a brand walks through, shown on
 * Action Center › Today as "Finish setting up · x of 7", and how each
 * step's state follows from the brand's data (getting_started_facts, 00196).
 * They sit beside the generated actions and never go through the signal
 * engine or get a Priority Score. Every state is worked out from the
 * brand's data and records, so a brand's steps done carry over.
 *
 * The explore pages (Visibility, the answers, Mentions, Citations and AI
 * Referral Traffic) still record their first visit (PAGE_STEPS), but aren't
 * listed; Today's focus covers the first work on content.
 */

/** Every step is a set-up step (Chat's and MCP's onboarding reads name it). */
export type GettingStartedStage = 'setup';

export type GettingStartedStepKey =
  | 'kpis'
  | 'competitors'
  | 'topics'
  | 'prompts'
  | 'gsc'
  | 'ga'
  | 'snippet';

/** The explore pages whose first visit is recorded (getting_started_page_opened). */
export type PageOpenedStepKey = 'visibility' | 'answers' | 'mentions' | 'citations' | 'traffic';

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

/** The set-up steps, in order. */
export const GETTING_STARTED_STEPS: readonly GettingStartedStepDef[] = [
  { key: 'kpis', stage: 'setup', href: '/dashboard/action-center/kpis' },
  { key: 'competitors', stage: 'setup', href: '/dashboard/competitors' },
  { key: 'topics', stage: 'setup', href: '/dashboard/prompts/topics' },
  { key: 'prompts', stage: 'setup', href: '/dashboard/prompts/suggestions' },
  { key: 'gsc', stage: 'setup', href: INTEGRATIONS_HREF, optional: true },
  { key: 'ga', stage: 'setup', href: INTEGRATIONS_HREF, optional: true },
  { key: 'snippet', stage: 'setup', href: '/dashboard/traffic' },
];

export const MIN_COMPETITORS = 3;
export const MIN_TOPICS = 3;
export const PROMPTS_PER_TOPIC = 3;

/** The explore pages whose first visit is recorded. */
const PAGE_STEPS: readonly { path: string; step: PageOpenedStepKey }[] = [
  { path: '/dashboard/insights', step: 'visibility' },
  { path: '/dashboard/prompts/tracked', step: 'answers' },
  { path: '/dashboard/mentions', step: 'mentions' },
  { path: '/dashboard/citations', step: 'citations' },
  { path: '/dashboard/traffic', step: 'traffic' },
];

/** The explore page a dashboard path opens, if any (no locale prefix). */
export function pageOpenedStep(pathname: string): PageOpenedStepKey | null {
  // /dashboard/prompts shows the tracked prompts too.
  const path = pathname === '/dashboard/prompts' ? '/dashboard/prompts/tracked' : pathname;
  const hit = PAGE_STEPS.find((p) => path === p.path || path.startsWith(`${p.path}/`));
  return hit?.step ?? null;
}

export function isPageOpenedStep(step: string): step is PageOpenedStepKey {
  return PAGE_STEPS.some((p) => p.step === step);
}

export type GettingStartedRecord = 'opened' | 'skipped' | 'done';

export interface GettingStartedFacts {
  startedAt: string | null;
  dismissedAt: string | null;
  /** When someone chose to run it; null while a later brand still asks (00197). */
  confirmedAt: string | null;
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
  /** Content sent to the CMS or completed in the last 30 days. */
  contentRecent: number;
  audits: number;
  /** Content Editor drafts made ready or published, by method (00234). */
  draftsCreated: number;
  draftsOptimized: number;
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
  /** A brand added beside others: "Run Getting started for it?" is open. */
  asking: boolean;
  /**
   * The existing-customer rule (AC-ALT2 §5): fewer than 3 competitors or
   * topics, no Search Console, or no content in 30 days. Offers "Start
   * getting started" while it isn't running.
   */
  needsSetup: boolean;
  /** Skipped (Today's Hide for the brand, or a new brand's question). */
  skipped: boolean;
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
    // A database without 00197 has no confirmed_at: what started runs.
    confirmedAt: 'confirmed_at' in r ? str(r.confirmed_at) : str(r.started_at),
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
    contentRecent: num(r.content_recent),
    audits: num(r.audits),
    draftsCreated: num(r.drafts_created),
    draftsOptimized: num(r.drafts_optimized),
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
  }
}

const complete = (s: GettingStartedStep) => s.state === 'done' || s.state === 'skipped';

/** The brand's 7 set-up steps and where Getting started stands for it. */
export function buildGettingStarted(f: GettingStartedFacts): GettingStartedStatus {
  const steps = GETTING_STARTED_STEPS.map((def) => ({
    ...def,
    ...stepState(def.key, f),
    updatedAt: f.recordedAt[def.key] ?? null,
  }));
  const running = Boolean(f.startedAt) && !f.dismissedAt;
  return {
    active: running && Boolean(f.confirmedAt),
    asking: running && !f.confirmedAt,
    needsSetup:
      f.competitors < MIN_COMPETITORS ||
      f.topicPrompts.length < MIN_TOPICS ||
      !f.gsc ||
      f.contentRecent === 0,
    skipped: Boolean(f.dismissedAt),
    steps,
    done: steps.filter(complete).length,
    total: steps.length,
  };
}
