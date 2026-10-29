'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { TeamRole } from '@/components/providers/role-provider';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { readPrecedenceContext } from '@/lib/chat/precedence-context';
import {
  ADMIN_POLICIES,
  effectivePolicy,
  policyChoiceLock,
  policyChoices,
  type AdminPolicy,
  type ChatSettings,
  type PrecedenceContext,
} from '@/lib/chat/precedence';
import { CHAT_TOOLS, chatToolByKey } from '@/lib/chat/registry/tools';
import {
  EXECUTE_GROUPS,
  type ExecuteGroup,
  type ToolArea,
  type ToolClass,
  type ToolFlags,
  type ToolPolicy,
} from '@/lib/chat/registry/define-tool';
import { planCardOf, type PlanCard } from '@/lib/chat/access';

/**
 * Settings › Chat (CHAT-20 §5, §8b; mockup #g-policy), behind CHAT_AGENTIC:
 * the tool policy per tool, Full auto for members, "Don't ask again", the
 * go-live groups Managers may click through, and the person's own "Don't
 * ask again" ticks. Everyone reads the rules Chat follows for them; only an
 * Admin changes the workspace's, and only within what each tool and the
 * plan allow (policyChoices, policyChoiceLock), checked here again. The
 * person removes their own ticks.
 *
 * Every action answers { ok } and never throws for a refusal or an
 * unreachable database (#1777): the page says what happened in plain words.
 */

export type SettingsFailure =
  | 'chat_off'
  | 'forbidden'
  | 'invalid'
  | 'locked'
  | 'read_only'
  | 'failed';
export type SettingsResult = { ok: true } | { ok: false; failure: SettingsFailure };

/** A tool as Settings › Chat lists it: by its label key, never its name. */
export interface PolicyRow {
  key: string;
  area: ToolArea;
  class: ToolClass;
  flags: ToolFlags;
  /** What applies now: the Admin's choice, else the row's default. */
  policy: ToolPolicy;
  defaultPolicy: ToolPolicy;
  /** Set by an Admin, not the default. */
  changed: boolean;
  /** What an Admin may pick besides the default, and which the plan locks. */
  choices: { policy: AdminPolicy; locked: boolean }[];
}

export interface ChatSettingsView {
  role: TeamRole;
  plan: PlanCard | null;
  /** Full auto and "Don't ask again" need Growth: the plan, when this workspace's lacks it. */
  fullAutoLocked: 'growth' | null;
  fullAutoForMembers: boolean;
  dontAskAgain: boolean;
  managerExecuteOff: ExecuteGroup[];
  rows: PolicyRow[];
  /** The person's own "Don't ask again" ticks, by label key. */
  autoChoices: string[];
}

interface Who {
  userId: string;
  organizationId: string;
  ctx: PrecedenceContext;
}

async function who(): Promise<Who | null> {
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
  const ctx = await readPrecedenceContext({
    userId: user.id,
    organizationId,
    mode: 'ask_first',
    surface: 'chat',
  });
  return ctx ? { userId: user.id, organizationId, ctx } : null;
}

function rowsOf(ctx: PrecedenceContext): PolicyRow[] {
  return CHAT_TOOLS.map((tool) => ({
    key: tool.labelKey,
    area: tool.area,
    class: tool.class,
    flags: { ...tool.flags },
    policy: effectivePolicy(tool, ctx.settings),
    defaultPolicy: tool.defaultPolicy,
    changed: tool.labelKey in ctx.settings.toolPolicies,
    choices: policyChoices(tool).map((policy) => ({
      policy,
      locked: policyChoiceLock(ctx.plan, policy) !== null,
    })),
  }));
}

/** The page's facts for the signed-in person; null while Chat is off or the read fails. */
export async function getChatSettingsView(): Promise<
  { ok: true; view: ChatSettingsView } | { ok: false; failure: 'chat_off' | 'failed' }
> {
  try {
    const me = await who();
    if (!me) return { ok: false, failure: 'chat_off' };
    const { ctx } = me;
    return {
      ok: true,
      view: {
        role: ctx.role,
        plan: planCardOf(ctx.plan),
        fullAutoLocked: ctx.plan.fullAuto ? null : 'growth',
        fullAutoForMembers: ctx.settings.fullAutoForMembers,
        dontAskAgain: ctx.settings.dontAskAgain,
        managerExecuteOff: [...ctx.settings.managerExecuteOff],
        rows: rowsOf(ctx),
        autoChoices: [...ctx.autoChoices].filter((key) => chatToolByKey(key)),
      },
    };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** The settings an Admin may change, read and checked; a failure otherwise. */
async function asAdmin(): Promise<{ ok: true; me: Who } | { ok: false; failure: SettingsFailure }> {
  const me = await who();
  if (!me) return { ok: false, failure: 'chat_off' };
  if (me.ctx.role !== 'admin') return { ok: false, failure: 'forbidden' };
  if (!me.ctx.plan.writable) return { ok: false, failure: 'read_only' };
  return { ok: true, me };
}

/** Writes the workspace's row with what changed, keeping the rest, and who changed it. */
async function saveSettings(me: Who, next: Partial<ChatSettings>): Promise<SettingsResult> {
  const settings = { ...me.ctx.settings, ...next };
  const { error } = await supabaseAdmin.from('chat_settings').upsert(
    {
      organization_id: me.organizationId,
      tool_policies: { ...settings.toolPolicies },
      full_auto_for_members: settings.fullAutoForMembers,
      dont_ask_again: settings.dontAskAgain,
      manager_execute_off: [...settings.managerExecuteOff],
      updated_by: me.userId,
    },
    { onConflict: 'organization_id' },
  );
  return error ? { ok: false, failure: 'failed' } : { ok: true };
}

/**
 * Sets a tool's policy, or `default` to give it back its row's default. Only
 * a choice the row offers and the plan allows.
 */
export async function setToolPolicy(
  key: string,
  policy: AdminPolicy | 'default',
): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    const tool = chatToolByKey(key);
    if (!tool) return { ok: false, failure: 'invalid' };
    const toolPolicies = { ...admin.me.ctx.settings.toolPolicies };
    if (policy === 'default') {
      delete toolPolicies[key];
    } else {
      if (!ADMIN_POLICIES.includes(policy) || !policyChoices(tool).includes(policy)) {
        return { ok: false, failure: 'invalid' };
      }
      if (policyChoiceLock(admin.me.ctx.plan, policy)) return { ok: false, failure: 'locked' };
      toolPolicies[key] = policy;
    }
    return await saveSettings(admin.me, { toolPolicies });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Every tool back to its row's default. */
export async function resetToolPolicies(): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    return await saveSettings(admin.me, { toolPolicies: {} });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Full auto for people other than Admins, or "Don't ask again" (both Growth and up). */
export async function setChatSwitch(
  name: 'fullAutoForMembers' | 'dontAskAgain',
  on: boolean,
): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    if (name !== 'fullAutoForMembers' && name !== 'dontAskAgain') {
      return { ok: false, failure: 'invalid' };
    }
    // Both are Growth and up (CHAT-20 §7): below it, neither applies.
    if (!admin.me.ctx.plan.fullAuto) return { ok: false, failure: 'locked' };
    return await saveSettings(admin.me, { [name]: on === true });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Whether Managers may click through a go-live group (CHAT-20 §4). */
export async function setManagerExecute(
  group: ExecuteGroup,
  allowed: boolean,
): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    if (!EXECUTE_GROUPS.includes(group)) return { ok: false, failure: 'invalid' };
    const off = new Set(admin.me.ctx.settings.managerExecuteOff);
    if (allowed) off.delete(group);
    else off.add(group);
    // In the switches' order, as the column keeps them distinct.
    return await saveSettings(admin.me, {
      managerExecuteOff: EXECUTE_GROUPS.filter((g) => off.has(g)),
    });
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Removes one of the person's own "Don't ask again" ticks. */
export async function removeAutoChoice(key: string): Promise<SettingsResult> {
  try {
    const me = await who();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (!/^[a-z][A-Za-z0-9]{1,63}$/.test(key)) return { ok: false, failure: 'invalid' };
    const { error } = await supabaseAdmin
      .from('chat_auto_choices')
      .delete()
      .eq('user_id', me.userId)
      .eq('organization_id', me.organizationId)
      .eq('tool_key', key);
    return error ? { ok: false, failure: 'failed' } : { ok: true };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}
