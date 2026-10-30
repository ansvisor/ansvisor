'use server';

import { createHash } from 'crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberAuth } from '@/lib/member-emails';
import type { TeamRole } from '@/components/providers/role-provider';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { parseTeamRole } from '@/lib/chat/precedence';
import {
  ACCESS_REQUEST_RULES,
  MAX_DRAFTED_CHANGE_CHARS,
  MAX_PENDING_REQUESTS,
  MAX_REQUESTS_PER_DAY,
  REQUEST_HISTORY_DAYS,
  type AccessRequest,
  type AccessRequestStatus,
} from '@/lib/chat/access-requests';

/**
 * "Ask your Admin" (CHAT-20 §4c, registry row 80a `access.request`), behind
 * CHAT_AGENTIC: a person whose role, plan or tool policy kept Chat from a
 * change asks the workspace's Admins, only by their own click. Admins see
 * the requests in Settings › Team › Roles & access › Requests and approve
 * or dismiss them; the first to act decides for all. The requester sees
 * theirs, and may withdraw one while it is pending. Rows in
 * chat_access_requests (00403), written here with the service role after
 * these checks.
 */

interface Member {
  userId: string;
  organizationId: string;
  role: TeamRole;
}

async function member(): Promise<Member | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const role = parseTeamRole(profile?.role);
  const organizationId = profile?.organization_id;
  if (!organizationId || !role || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId, role };
}

const requestSchema = z.object({
  asked: z.string().trim().min(1).max(500),
  ruleKind: z.enum(ACCESS_REQUEST_RULES),
  ruleDetail: z.string().trim().max(500).default(''),
  toolKey: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]{1,63}$/)
    .nullish(),
  // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
  brandId: z.guid().nullish(),
  conversationId: z.guid().nullish(),
  draftedChange: z
    .record(z.string(), z.unknown())
    .nullish()
    .refine(
      (change) => change == null || JSON.stringify(change).length <= MAX_DRAFTED_CHANGE_CHARS,
    ),
});

export type AccessRequestInput = z.input<typeof requestSchema>;

export type RequestAccessResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'chat_off' | 'admin' | 'invalid' | 'too_many' | 'daily_limit' | 'already_today';
    };

/** The fingerprint of an asked change: one request a day for the same one. */
function askedHash(toolKey: string | null, asked: string): string {
  return createHash('sha256')
    .update(`${toolKey ?? ''}\n${asked.toLowerCase().replace(/\s+/g, ' ')}`)
    .digest('hex');
}

/** Sends a request to the workspace's Admins. Admins don't need to ask. */
export async function requestAccess(input: AccessRequestInput): Promise<RequestAccessResult> {
  const who = await member();
  if (!who) return { ok: false, reason: 'chat_off' };
  if (who.role === 'admin') return { ok: false, reason: 'admin' };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const req = parsed.data;

  const [pending, sentToday, brand, conversation] = await Promise.all([
    supabaseAdmin
      .from('chat_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requester_id', who.userId)
      .eq('status', 'pending'),
    // The table's requested_on: today in UTC.
    supabaseAdmin
      .from('chat_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requester_id', who.userId)
      .eq('requested_on', new Date().toISOString().slice(0, 10)),
    req.brandId
      ? supabaseAdmin
          .from('brands')
          .select('id')
          .eq('id', req.brandId)
          .eq('organization_id', who.organizationId)
          .maybeSingle()
      : null,
    req.conversationId
      ? supabaseAdmin
          .from('chat_conversations')
          .select('id')
          .eq('id', req.conversationId)
          .eq('user_id', who.userId)
          .eq('organization_id', who.organizationId)
          .maybeSingle()
      : null,
  ]);
  if (pending.error) throw new Error(pending.error.message);
  if ((pending.count ?? 0) >= MAX_PENDING_REQUESTS) return { ok: false, reason: 'too_many' };
  if (sentToday.error) throw new Error(sentToday.error.message);
  if ((sentToday.count ?? 0) >= MAX_REQUESTS_PER_DAY) return { ok: false, reason: 'daily_limit' };

  const toolKey = req.toolKey ?? null;
  const { data, error } = await supabaseAdmin
    .from('chat_access_requests')
    .insert({
      organization_id: who.organizationId,
      requester_id: who.userId,
      // A brand or chat that isn't theirs is dropped, not trusted.
      brand_id: brand?.data ? req.brandId! : null,
      conversation_id: conversation?.data ? req.conversationId! : null,
      asked: req.asked,
      asked_hash: askedHash(toolKey, req.asked),
      tool_key: toolKey,
      rule_kind: req.ruleKind,
      rule_detail: req.ruleDetail,
      drafted_change: (req.draftedChange ?? null) as never,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'already_today' };
    throw new Error(error.message);
  }
  return { ok: true, id: data.id };
}

/** Withdraws the person's own pending request. False when it isn't one any more. */
export async function withdrawAccessRequest(id: string): Promise<boolean> {
  const who = await member();
  if (!who || !z.guid().safeParse(id).success) return false;
  const { data, error } = await supabaseAdmin
    .from('chat_access_requests')
    .update({ status: 'withdrawn', decided_by: who.userId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('requester_id', who.userId)
    .eq('organization_id', who.organizationId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * An Admin approves or dismisses a pending request of their workspace. The
 * first Admin to act decides it: false when another already had.
 */
export async function decideAccessRequest(
  id: string,
  decision: 'approved' | 'rejected',
): Promise<boolean> {
  const who = await member();
  if (!who || who.role !== 'admin') throw new Error('Only Admins decide access requests');
  if (!z.guid().safeParse(id).success || !['approved', 'rejected'].includes(decision)) {
    return false;
  }
  const { data, error } = await supabaseAdmin
    .from('chat_access_requests')
    .update({ status: decision, decided_by: who.userId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', who.organizationId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Why a read gave nothing: Chat is off for the person, or the database didn't answer. */
export type RequestsReadFailure = 'chat_off' | 'failed';

/**
 * The requests a person sees: an Admin, the workspace's; anyone else, their
 * own. Pending first, then the decided ones of the last weeks. Never throws
 * (#1777): a failed read is `failed`.
 */
export async function listAccessRequests(): Promise<
  | { ok: true; isAdmin: boolean; requests: AccessRequest[] }
  | { ok: false; failure: RequestsReadFailure }
> {
  try {
    const read = await readAccessRequests();
    return read ? { ok: true, ...read } : { ok: false, failure: 'chat_off' };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

async function readAccessRequests(): Promise<{
  isAdmin: boolean;
  requests: AccessRequest[];
} | null> {
  const who = await member();
  if (!who) return null;
  const isAdmin = who.role === 'admin';
  const since = new Date(Date.now() - REQUEST_HISTORY_DAYS * 86_400_000).toISOString();
  let query = supabaseAdmin
    .from('chat_access_requests')
    .select(
      'id, requester_id, asked, tool_key, rule_kind, rule_detail, status, created_at, decided_at',
    )
    .eq('organization_id', who.organizationId)
    .or(`status.eq.pending,created_at.gte."${since}"`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!isAdmin) query = query.eq('requester_id', who.userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const ids = [...new Set(rows.map((row) => row.requester_id))];
  const [profiles, auth] = await Promise.all([
    ids.length
      ? supabaseAdmin.from('profiles').select('id, full_name').in('id', ids)
      : { data: [], error: null },
    readMemberAuth(ids),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name?.trim() || null]));

  const requests = rows.map((row) => ({
    id: row.id,
    requester:
      names.get(row.requester_id) || auth.get(row.requester_id)?.email?.split('@')[0] || '',
    isYours: row.requester_id === who.userId,
    asked: row.asked,
    toolKey: row.tool_key,
    ruleKind: row.rule_kind as AccessRequest['ruleKind'],
    ruleDetail: row.rule_detail,
    status: row.status as AccessRequestStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }));
  // Pending ones first, each part newest first.
  requests.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  return { isAdmin, requests };
}

/**
 * How many requests wait for an Admin: the count on Roles & access, 0 for
 * anyone else. Never throws, as above.
 */
export async function countPendingAccessRequests(): Promise<
  { ok: true; count: number } | { ok: false; failure: RequestsReadFailure }
> {
  try {
    const who = await member();
    if (!who) return { ok: false, failure: 'chat_off' };
    if (who.role !== 'admin') return { ok: true, count: 0 };
    const { count, error } = await supabaseAdmin
      .from('chat_access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', who.organizationId)
      .eq('status', 'pending');
    return error ? { ok: false, failure: 'failed' } : { ok: true, count: count ?? 0 };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}
