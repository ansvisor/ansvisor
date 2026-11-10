import { useEffect } from 'react';
import { track } from '@/lib/analytics';
import type { UpgradeReason } from '@/lib/billing/subscription-access';

/**
 * What a person tried and couldn't do, sent to PostHog through lib/analytics
 * (nothing is sent self-hosted): the upgrade walls they met, the error
 * toasts they saw and the key flows they started without finishing. The
 * cancel analysis reads them for the person who cancelled; PostHog adds the
 * page ($pathname) itself. They carry ids, kinds and counts only, never a
 * name, a domain, a prompt or a toast's words.
 */
export const FRICTION_EVENTS = {
  /** The upgrade dialog, a plan gate or a plan limit was shown. */
  upgradeWallShown: 'upgrade_wall_shown',
  /** An error toast was shown: its kind, never its text. */
  errorShown: 'error_shown',
  /** A key flow (FRICTION_FLOWS) was started. */
  flowStarted: 'flow_started',
  /** It finished. */
  flowCompleted: 'flow_completed',
  /** It failed: with the error's stable code when there is one, never its message. */
  flowFailed: 'flow_failed',
} as const;

/** The key flows, by their `flow` property; where each starts and ends. */
export const FRICTION_FLOWS = {
  /** Add a new brand (/dashboard/brands/new): the page opened, to Finish. */
  brandAdd: 'brand_add',
  /** Prompts' Add prompt dialog: opened, to prompts added (one by one or Bulk import). */
  promptAdd: 'prompt_add',
  /** A CMS card's Connect in Settings, to the CMS connected; `target` names the CMS. */
  cmsConnect: 'cms_connect',
  /**
   * A page started: New content's Open editor, to the draft with its writer
   * (the editor, the Content Agent or the team), or Write this, to the
   * Content Agent writing it.
   */
  contentGenerate: 'content_generate',
  /**
   * A Chat message sent, to its answer. Not sent yet: Chat sends and follows
   * its runs inside chat-thread-view.tsx, with no hook or store between.
   */
  chatAnswer: 'chat_answer',
  /** Site Audit's Run audit, or the pages or opportunities picked, to the audits running. */
  siteAuditRun: 'site_audit_run',
} as const;

export type FrictionFlow = (typeof FRICTION_FLOWS)[keyof typeof FRICTION_FLOWS];

/** The CMS a cms_connect is for. */
export type CmsTarget = 'webflow' | 'wordpress' | 'wix' | 'framer' | 'hubspot';

/**
 * Why a wall stood in the way: the plan lacks the feature ('plan') or is at
 * its limit ('plan_limit'); the workspace is read-only, its plan or trial
 * over ('read_only'), or a payment is being retried ('payment_failed'); or
 * the brand on screen is the demo brand ('demo').
 */
export type UpgradeWallReason = 'plan' | 'plan_limit' | 'read_only' | 'payment_failed' | 'demo';

export interface UpgradeWall {
  reason: UpgradeWallReason;
  /** The plan feature key, or a short id of what was locked; null when not known. */
  feature?: string | null;
  /** A short id of where it was shown; null when not known. */
  source?: string | null;
}

/** An id, a key or a code: short, lowercase letters, digits and _ only. Anything else is left out. */
const STABLE_ID = /^[a-z][a-z0-9_]{0,39}$/;

function stableId(value: string | null | undefined): string | null {
  return typeof value === 'string' && STABLE_ID.test(value) ? value : null;
}

/** The upgrade dialog's reason (UpgradeDialogProvider) as a wall's. */
export function upgradeWallReason(reason: UpgradeReason): UpgradeWallReason {
  if (reason === 'payment_failed' || reason === 'demo') return reason;
  return 'read_only';
}

export function trackUpgradeWall({ reason, feature = null, source = null }: UpgradeWall): void {
  track(FRICTION_EVENTS.upgradeWallShown, {
    feature: stableId(feature),
    reason,
    source: stableId(source),
  });
}

/**
 * Counts a wall each time it is shown: on mount, and again when it becomes
 * another one. Null while none is shown.
 */
export function useUpgradeWallShown(wall: UpgradeWall | null): void {
  const reason = wall?.reason ?? null;
  const feature = wall?.feature ?? null;
  const source = wall?.source ?? null;
  useEffect(() => {
    if (reason) trackUpgradeWall({ reason, feature, source });
  }, [reason, feature, source]);
}

/** A key flow's three events; `cms_connect` names its CMS in each. */
export interface FlowEvents {
  started(): void;
  completed(): void;
  /** `errorCode`: a stable code ('plan_limit', 'invalid'…); anything else is sent as null. */
  failed(errorCode?: string | null): void;
}

export function frictionFlow(flow: 'cms_connect', props: { target: CmsTarget }): FlowEvents;
export function frictionFlow(flow: Exclude<FrictionFlow, 'cms_connect'>): FlowEvents;
export function frictionFlow(flow: FrictionFlow, props: { target?: CmsTarget } = {}): FlowEvents {
  const base = { flow, ...props };
  return {
    started: () => track(FRICTION_EVENTS.flowStarted, { ...base }),
    completed: () => track(FRICTION_EVENTS.flowCompleted, { ...base }),
    failed: (errorCode = null) =>
      track(FRICTION_EVENTS.flowFailed, { ...base, error_code: stableId(errorCode) }),
  };
}

/** An error toast was shown (the app's <Toaster> counts them): its kind, never its text. */
export function trackErrorShown(): void {
  track(FRICTION_EVENTS.errorShown, { kind: 'toast' });
}
