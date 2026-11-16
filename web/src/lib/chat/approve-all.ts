import { after } from 'next/server';
import type {
  ApproveFailure,
  ApproveGroupResult,
  ListGroupsResult,
} from '@/lib/actions/chat-approve-all';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { driveRun, prepareResume, type ChatActor, type ResumeAction } from './engine';
import { chatAgenticEnabled } from './flag';
import { readPendingApprovals, togetherOf, versionOf, viewOf } from './pending-approvals';

/**
 * One Approve all per Content draft (the Inbox), behind its server actions
 * (lib/actions/chat-approve-all.ts): the person's waiting runs that each ask
 * to change the same draft (pending-approvals.ts). Server only, with the
 * service role: the actions load it when they are called, so the Inbox's
 * components never have the admin client in their imports.
 *
 * Each run is approved through prepareResume, as its own card's Approve is,
 * and its driver starts at once, as the approve route's streamRun starts it:
 * Approve all waits until each card's change is made or not, and says how
 * many were made; the runs then go on in the request's background (after()).
 * Nothing streams here. The Inbox page gives the request the run routes'
 * 300 s (its maxDuration, RUN_REQUEST_MS). A run its request leaves
 * unfinished ends as timed out, as on the single path (sweepChatRuns).
 */

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

/** The person's draft groups on the brand: drafts several runs wait on. Throws when they can't be read. */
export async function readDraftGroups(brandId: string): Promise<ListGroupsResult> {
  const actor = await member();
  if (!actor) return { ok: true, groups: [] };
  const groups = await readPendingApprovals(actor, brandId);
  return {
    ok: true,
    groups: groups
      .filter((group) => group.items.length > 1)
      .map((group) => viewOf(actor, brandId, group)),
  };
}

/**
 * Drives an approved run from now, kept alive in the request's background
 * (after()) once the answer has gone; outside a request (a test) it goes on
 * by itself. True once its card's change is made; false when it wasn't.
 */
function driveCard(actor: ChatActor, runId: string, resume: ResumeAction): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const driver = driveRun(actor, runId, resume, { onCard: resolve })
      .catch((error) => console.error('[chat/approve-all] a run failed to go on:', error))
      .finally(() => resolve(false));
    try {
      after(() => driver);
    } catch {
      // No request around it: nothing to keep alive.
    }
  });
}

/**
 * Approves every card of the draft's group, once the action has checked the
 * plan. The group is read again here and is the server's own: the key picks
 * it, and `version` must be the cards the person saw (a card that changed
 * since is refused, `changed`). A group with more than one change that
 * rewrites the page is refused (`one_by_one`), whatever the browser showed:
 * those changes would overwrite each other. An item that can't be approved,
 * or whose change wasn't made, is in `failed`; the others go on regardless,
 * and `made` counts the changes made.
 */
export async function approveDraftGroup(
  brandId: string,
  groupKey: string,
  version: string,
): Promise<ApproveGroupResult> {
  const actor = await member();
  if (!actor) return { ok: false, reason: 'signed_out' };
  const groups = await readPendingApprovals(actor, brandId);
  const group = groups.find((g) => viewOf(actor, brandId, g).key === groupKey);
  if (!group) return { ok: false, reason: 'not_found' };
  if (versionOf(group.items) !== version) return { ok: false, reason: 'changed' };
  if (!togetherOf(group.items)) return { ok: false, reason: 'one_by_one' };

  const failed: ApproveFailure[] = [];
  const driven: { item: (typeof group.items)[number]; made: Promise<boolean> }[] = [];
  for (const item of group.items) {
    const named = { agent: item.agent, summary: item.summary };
    try {
      const prepared = await prepareResume(actor, item.runId, 'approve', {
        n: item.n,
        digest: item.digest,
      });
      if (!prepared.ok) {
        failed.push({ ...named, error: prepared.message, approved: false });
        continue;
      }
      driven.push({ item, made: driveCard(actor, item.runId, prepared.resume) });
    } catch (error) {
      console.error('[chat/approve-all] could not approve a run:', error);
      failed.push({ ...named, error: '', approved: false });
    }
  }
  let made = 0;
  for (const { item, made: card } of driven) {
    if (await card) made += 1;
    else failed.push({ agent: item.agent, summary: item.summary, error: '', approved: true });
  }
  return { ok: true, made, failed };
}
