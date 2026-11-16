'use server';

import type { ApprovalGroup } from '@/lib/chat/pending-approvals';
import {
  DemoBrandError,
  SubscriptionInactiveError,
  assertWritable,
} from '@/lib/subscription-guard';

/**
 * One Approve all per Content draft (the Inbox): the person's waiting runs
 * that each ask to change the same draft. The work is lib/chat/approve-all.ts's,
 * with the service role, loaded only when an action is called: the Inbox's
 * components import this file, and never the admin client through it. The
 * Inbox page gives the request the run routes' 300 s (its maxDuration,
 * RUN_REQUEST_MS), never this file: a 'use server' file exports async
 * functions only (#2347).
 */

/** A change Approve all didn't make: not approved (`error` says why, or ''), or approved and not made. */
export type ApproveFailure = {
  agent: string;
  summary: string;
  error: string;
  /** Approved, and its run went on, but the change wasn't made: its chat says why. */
  approved: boolean;
};

export type ListGroupsResult = { ok: true; groups: ApprovalGroup[] } | { ok: false };

export type ApproveGroupResult =
  /** `made`: the changes made, each its step done; never more than were. */
  | { ok: true; made: number; failed: ApproveFailure[] }
  | {
      ok: false;
      /** one_by_one: more than one change rewrites the page (togetherOf). */
      reason: 'signed_out' | 'not_found' | 'changed' | 'one_by_one' | 'read_only';
    };

/** The person's draft groups on the brand: drafts several runs wait on. */
export async function listDraftApprovalGroups(brandId: string): Promise<ListGroupsResult> {
  try {
    const { readDraftGroups } = await import('@/lib/chat/approve-all');
    return await readDraftGroups(brandId);
  } catch (error) {
    console.error('[chat/approve-all] could not read the groups:', error);
    return { ok: false };
  }
}

/**
 * Approves every card of the draft's group (approveDraftGroup), once the
 * plan allows it: read-only while the workspace's plan isn't active, and on
 * the demo brand.
 */
export async function approveGroup(
  brandId: string,
  groupKey: string,
  version: string,
): Promise<ApproveGroupResult> {
  try {
    await assertWritable({ brandId });
  } catch (error) {
    if (error instanceof SubscriptionInactiveError || error instanceof DemoBrandError) {
      return { ok: false, reason: 'read_only' };
    }
    throw error;
  }
  const { approveDraftGroup } = await import('@/lib/chat/approve-all');
  return approveDraftGroup(brandId, groupKey, version);
}
