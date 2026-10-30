'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberAuth } from '@/lib/member-emails';
import type { TeamRole } from '@/components/providers/role-provider';
import type { PlanId } from '@/config/plans';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { readPrecedenceContext } from '@/lib/chat/precedence-context';
import { parseTeamRole } from '@/lib/chat/precedence';
import type { ExecuteGroup } from '@/lib/chat/registry/define-tool';
import { planCardOf, yourAccessRows, type PlanCard, type YourAccessRow } from '@/lib/chat/access';
import { planGateLock } from '@/lib/chat/plan-facts';
import { registryCatalog } from '@/lib/chat/registry/tools';

/**
 * What Settings › Team › Roles & access and Settings › Account › Your access
 * show (CHAT-20 §4a, §4b, §7a), read with the same facts the approval
 * precedence checks a tool call by, so a page and the server never
 * disagree. Null while the new Chat is off for the workspace (CHAT_AGENTIC):
 * the pages show nothing new.
 */

export interface ChatAccess {
  role: TeamRole;
  /** Null off the cloud: no plan. */
  plan: PlanCard | null;
  yourAccess: YourAccessRow[];
  /** The workspace switches that change a role's rights (Settings › Chat, 00401). */
  switches: {
    managerExecuteOff: ExecuteGroup[];
    fullAutoForMembers: boolean;
    /** The plan Full auto needs, when the workspace's doesn't have it. */
    fullAutoLocked: PlanId | null;
    /** Who changed them last; null when no one has. */
    setBy: string | null;
  };
  /** The plan each tool needs that the workspace doesn't have, by catalog key (§7a lock lines). */
  toolLocks: Record<string, PlanId>;
}

export interface RoleMember {
  userId: string;
  name: string;
  /** Admins only (§4a). */
  email: string | null;
  role: TeamRole;
  /** The last sign-in; null when never. */
  lastActiveAt: string | null;
  isYou: boolean;
}

async function viewer(): Promise<{ userId: string; organizationId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId };
}

/** Why a read gave nothing: Chat is off for the person, or the database didn't answer. */
export type AccessReadFailure = 'chat_off' | 'failed';

/**
 * The signed-in person's access and plan card. Never throws (#1777): a
 * failed read is `failed`, Chat off for them `chat_off`.
 */
export async function getChatAccess(): Promise<
  { ok: true; access: ChatAccess } | { ok: false; failure: AccessReadFailure }
> {
  try {
    const access = await readChatAccess();
    return access ? { ok: true, access } : { ok: false, failure: 'chat_off' };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

async function readChatAccess(): Promise<ChatAccess | null> {
  const who = await viewer();
  if (!who) return null;
  const [ctx, settings] = await Promise.all([
    readPrecedenceContext({ ...who, mode: 'ask_first', surface: 'chat' }),
    supabaseAdmin
      .from('chat_settings')
      .select('updated_by')
      .eq('organization_id', who.organizationId)
      .maybeSingle(),
  ]);
  if (!ctx) return null;
  const setById = settings.data?.updated_by ?? null;
  const setBy = setById
    ? await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', setById)
        .eq('organization_id', who.organizationId)
        .maybeSingle()
        .then(({ data }) => data?.full_name?.trim() || null)
    : null;
  return {
    role: ctx.role,
    plan: planCardOf(ctx.plan),
    yourAccess: yourAccessRows(ctx.role, ctx.settings.managerExecuteOff),
    switches: {
      managerExecuteOff: [...ctx.settings.managerExecuteOff],
      fullAutoForMembers: ctx.settings.fullAutoForMembers,
      fullAutoLocked: ctx.plan.fullAuto ? null : 'growth',
      setBy,
    },
    toolLocks: Object.fromEntries(
      registryCatalog().flatMap((entry) => {
        const lock = planGateLock(ctx.plan, entry.planGate);
        return lock ? [[entry.key, lock]] : [];
      }),
    ),
  };
}

/**
 * The workspace's members for Roles & access: name, role and last sign-in
 * for everyone, e-mails for Admins only (§4a). A member without a name goes
 * by the part of their e-mail before the @. Never throws, as above.
 */
export async function listRoleMembers(): Promise<
  { ok: true; members: RoleMember[] } | { ok: false; failure: AccessReadFailure }
> {
  try {
    const members = await readRoleMembers();
    return members ? { ok: true, members } : { ok: false, failure: 'chat_off' };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

async function readRoleMembers(): Promise<RoleMember[] | null> {
  const who = await viewer();
  if (!who) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, created_at')
    .eq('organization_id', who.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const viewerRole = parseTeamRole(rows.find((row) => row.id === who.userId)?.role);
  const auth = await readMemberAuth(rows.map((row) => row.id));
  return rows.flatMap((row) => {
    const role = parseTeamRole(row.role);
    if (!role) return [];
    const email = auth.get(row.id)?.email ?? null;
    return [
      {
        userId: row.id,
        name: row.full_name?.trim() || email?.split('@')[0] || '',
        email: viewerRole === 'admin' ? email : null,
        role,
        lastActiveAt: auth.get(row.id)?.lastSignInAt ?? null,
        isYou: row.id === who.userId,
      },
    ];
  });
}
