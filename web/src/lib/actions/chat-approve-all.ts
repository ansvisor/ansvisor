'use server';

import { after } from 'next/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { driveRun, prepareResume, type ChatActor } from '@/lib/chat/engine';
import {
  readPendingApprovals,
  versionOf,
  viewOf,
  type ApprovalGroup,
} from '@/lib/chat/pending-approvals';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  DemoBrandError,
  SubscriptionInactiveError,
  assertWritable,
} from '@/lib/subscription-guard';

/**
 * One Approve all per Content draft (the Inbox): the person's waiting runs
 * that each ask to change the same draft (lib/chat/pending-approvals.ts).
 * Each run is approved through prepareResume, as its own card's Approve is,
 * and then goes on in the background (after(), as the approve route's
 * streamRun and the agent driver do): nothing streams in this action.
 */

export type ApproveFailure = { agent: string; summary: string; error: string };

export type ListGroupsResult = { ok: true; groups: ApprovalGroup[] } | { ok: false };

export type ApproveGroupResult =
  | { ok: true; started: number; failed: ApproveFailure[] }
  | { ok: false; reason: 'signed_out' | 'not_found' | 'changed' | 'read_only' };

async function member(): Promise<ChatActor | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the member: ${error.message}`);
  const organizationId = profile?.organization_id as string | null | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, email: user.email ?? null, organizationId };
}

/** The person's draft groups on the brand: drafts several runs wait on. */
export async function listDraftApprovalGroups(brandId: string): Promise<ListGroupsResult> {
  try {
    const actor = await member();
    if (!actor) return { ok: true, groups: [] };
    const groups = await readPendingApprovals(actor, brandId);
    return {
      ok: true,
      groups: groups
        .filter((group) => group.items.length > 1)
        .map((group) => viewOf(actor, brandId, group)),
    };
  } catch (error) {
    console.error('[chat/approve-all] could not read the groups:', error);
    return { ok: false };
  }
}

/** In the request's background; outside one (a test), on its own. */
function inBackground(task: () => Promise<void>) {
  const guarded = () =>
    task().catch((error) => console.error('[chat/approve-all] a run failed to go on:', error));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/**
 * Approves every card of the draft's group. The group is read again here and
 * is the server's own: the key picks it, and `version` must be the cards the
 * person saw (a card that changed since is refused, `changed`). An item that
 * can't be approved is recorded in `failed`; the others go on regardless.
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
  const actor = await member();
  if (!actor) return { ok: false, reason: 'signed_out' };
  const groups = await readPendingApprovals(actor, brandId);
  const group = groups.find((g) => viewOf(actor, brandId, g).key === groupKey);
  if (!group) return { ok: false, reason: 'not_found' };
  if (versionOf(group.items) !== version) return { ok: false, reason: 'changed' };

  let started = 0;
  const failed: ApproveFailure[] = [];
  for (const item of group.items) {
    try {
      const prepared = await prepareResume(actor, item.runId, 'approve', {
        n: item.n,
        digest: item.digest,
      });
      if (!prepared.ok) {
        failed.push({ agent: item.agent, summary: item.summary, error: prepared.message });
        continue;
      }
      started += 1;
      inBackground(() => driveRun(actor, item.runId, prepared.resume));
    } catch (error) {
      console.error('[chat/approve-all] could not approve a run:', error);
      failed.push({ agent: item.agent, summary: item.summary, error: '' });
    }
  }
  return { ok: true, started, failed };
}
