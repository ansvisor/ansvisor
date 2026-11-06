'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { TeamRole } from '@/components/providers/role-provider';
import { autoGoLiveEnabled, chatAgenticEnabled } from '@/lib/chat/flag';
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
import { qualityPhase } from '@/lib/content/quality';
import { GO_LIVE_GROUPS, GO_LIVE_TERMS } from '@/lib/chat/go-live';
import {
  AGENT_WORK_KEY,
  isAgentWork,
  parseAgentWork,
  type AgentWorkChange,
  type AgentWorkView,
} from '@/lib/chat/agent-work';
import { logActivity } from '@/lib/chat/activity';
import { readProviderChoices } from '@/lib/chat/model-menu';
import {
  MODEL_PROVIDERS,
  isModelProvider,
  providerOn,
  type ModelProvider,
} from '@/lib/chat/model-providers';

/**
 * Settings › Chat (CHAT-20 §5, §8b; mockup #g-policy), behind CHAT_AGENTIC:
 * the tool policy per tool, Full auto for members, "Don't ask again", the
 * go-live groups Managers may click through, Agent work (AC-011, also on
 * Action Center › Today's gear), and the person's own "Don't ask again"
 * ticks. Everyone reads the rules Chat follows for them; only an
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
  | 'quality_off'
  | 'unavailable'
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
  /** Agents that publish on their own (AUTONOMOUS-GO-LIVE §7.1); null with its flag off or before 00443. */
  goLive: GoLiveView | null;
  /** The model providers Chat may use (W4-34): on or off, Anthropic locked on. */
  modelProviders: { id: ModelProvider; name: string; on: boolean; locked: boolean }[];
  /** Who starts agent work (AC-011), with its last change. */
  agentWork: AgentWorkView;
}

/** The workspace switch for agents going live on their own, as Settings › Chat shows it. */
export interface GoLiveView {
  on: boolean;
  /** When it was last turned on, and by whom (their name, else their e-mail). */
  since: string | null;
  byName: string | null;
  /** Content Quality is off: each page is checked by it before it goes live. */
  qualityOff: boolean;
  /** The workspace's name, for the responsibility dialog. */
  workspace: string;
}

/** A column 00443 adds, missing: the web ahead of its migration. */
const beforeGoLive = (error: { code?: string; message?: string } | null) =>
  !!error &&
  (error.code === '42703' || error.code === 'PGRST204') &&
  (error.message ?? '').includes('auto_go_live');

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
        // Hidden while staff haven't turned the feature on (CHAT_AUTO_GO_LIVE).
        goLive: autoGoLiveEnabled(me.organizationId) ? await readGoLive(me.organizationId) : null,
        modelProviders: await readModelProviders(me.organizationId),
        agentWork: agentWorkView(me, await readAgentWorkChange(me.organizationId)),
      },
    };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Each model provider as the page shows it: on or off, and whether it can change. */
async function readModelProviders(
  organizationId: string,
): Promise<ChatSettingsView['modelProviders']> {
  const choices = await readProviderChoices(organizationId);
  return MODEL_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    on: providerOn(choices, p.id),
    locked: p.locked,
  }));
}

/**
 * Turns a model provider on or off for the workspace (W4-34): Admins only;
 * Anthropic stays on, since Auto runs on its models. Its models leave the
 * menu, and the engine runs Auto in place of one, from the next run. The
 * change goes in the Activity log.
 */
export async function setModelProvider(provider: string, on: boolean): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    if (!isModelProvider(provider)) return { ok: false, failure: 'invalid' };
    if (MODEL_PROVIDERS.find((p) => p.id === provider)?.locked) {
      return { ok: false, failure: 'locked' };
    }
    const { me } = admin;
    const choices = { ...(await readProviderChoices(me.organizationId)), [provider]: on === true };
    const { error } = await supabaseAdmin
      .from('chat_settings')
      .upsert(
        { organization_id: me.organizationId, model_providers: choices, updated_by: me.userId },
        { onConflict: 'organization_id' },
      );
    if (error) return { ok: false, failure: 'failed' };
    await logActivity({
      organizationId: me.organizationId,
      userId: me.userId,
      brandId: null,
      place: { conversationId: null, runId: null, stepId: null },
      surface: 'chat',
      tool: MODEL_PROVIDERS_LABEL,
      mode: null,
      approval: { kind: 'run' },
      target: { type: 'chat_settings', id: me.organizationId },
      summary: {
        key: on ? 'modelProviderOn' : 'modelProviderOff',
        params: { provider: MODEL_PROVIDERS.find((p) => p.id === provider)?.name ?? provider },
      },
      undo: null,
    }).catch((err) => console.error('[chat-settings] could not log a provider change:', err));
    return { ok: true };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** The Activity log's label for model provider changes (chatTools.modelProviders). */
const MODEL_PROVIDERS_LABEL = { labelKey: 'modelProviders', class: 'write' } as const;

/** The workspace's go-live switch, with who turned it on; null before 00443. */
async function readGoLive(organizationId: string): Promise<GoLiveView | null> {
  const [settings, org] = await Promise.all([
    supabaseAdmin
      .from('chat_settings')
      .select('auto_go_live_groups, auto_go_live_at, auto_go_live_by')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabaseAdmin.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
  ]);
  if (beforeGoLive(settings.error)) return null;
  if (settings.error) throw new Error(settings.error.message);
  const row = settings.data;
  const byName = row?.auto_go_live_by ? await personName(row.auto_go_live_by) : null;
  return {
    on: GO_LIVE_GROUPS.every((group) => (row?.auto_go_live_groups ?? []).includes(group)),
    since: row?.auto_go_live_at ?? null,
    byName,
    qualityOff: qualityPhase() < 1,
    workspace: org.data?.name ?? '',
  };
}

/**
 * Turns agents' going live on their own on or off for the workspace
 * (AUTONOMOUS-GO-LIVE §7.1). On: Admins only, with Full auto's plan and
 * Content Quality on, after the responsibility dialog (its text's version
 * kept, with who and when). Off takes effect from the next call; agents'
 * own permissions are kept, inert.
 */
export async function setAutoGoLive(on: boolean, terms: number): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    const { me } = admin;
    if (!autoGoLiveEnabled(me.organizationId)) return { ok: false, failure: 'unavailable' };
    if (on) {
      if (!me.ctx.plan.fullAuto) return { ok: false, failure: 'locked' };
      if (qualityPhase() < 1) return { ok: false, failure: 'quality_off' };
      if (terms !== GO_LIVE_TERMS) return { ok: false, failure: 'invalid' };
    }
    const { error } = await supabaseAdmin.from('chat_settings').upsert(
      {
        organization_id: me.organizationId,
        auto_go_live_groups: on ? [...GO_LIVE_GROUPS] : [],
        ...(on
          ? {
              auto_go_live_by: me.userId,
              auto_go_live_at: new Date().toISOString(),
              auto_go_live_terms: GO_LIVE_TERMS,
            }
          : {}),
        updated_by: me.userId,
      },
      { onConflict: 'organization_id' },
    );
    if (beforeGoLive(error)) return { ok: false, failure: 'unavailable' };
    return error ? { ok: false, failure: 'failed' } : { ok: true };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** A person's name as a settings line says it: their full name, else their e-mail. */
async function personName(userId: string): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  const name = profile?.full_name?.trim();
  if (name) return name;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

// ─── Agent work (AC-011) ────────────────────────────────────────────────────

/** A table or column 00481 adds, missing: the web ahead of its migration. */
const beforeAgentWork = (error: { code?: string } | null) =>
  !!error && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '');

/** Agent work's last change, with who made it; null when nobody changed it yet, or before 00481. */
async function readAgentWorkChange(organizationId: string): Promise<AgentWorkChange | null> {
  const { data, error } = await supabaseAdmin
    .from('setting_changes')
    .select('old_value, new_value, changed_by, changed_at')
    .eq('organization_id', organizationId)
    .eq('setting_key', AGENT_WORK_KEY)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (beforeAgentWork(error)) return null;
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    byName: data.changed_by ? await personName(data.changed_by) : null,
    at: data.changed_at,
    from: isAgentWork(data.old_value) ? data.old_value : null,
    to: parseAgentWork(data.new_value),
  };
}

function agentWorkView(me: Who, lastChange: AgentWorkChange | null): AgentWorkView {
  return {
    value: parseAgentWork(me.ctx.settings.agentWork),
    // An ended plan is the save's to say (read_only), with the plan to choose.
    canChange: me.ctx.role === 'admin',
    lastChange,
  };
}

/**
 * Agent work for the gear on Action Center › Today: every member reads it,
 * with its last change; chat_off while Chat is off (its agents are Chat's).
 */
export async function getAgentWorkView(): Promise<
  { ok: true; view: AgentWorkView } | { ok: false; failure: 'chat_off' | 'failed' }
> {
  try {
    const me = await who();
    if (!me) return { ok: false, failure: 'chat_off' };
    return { ok: true, view: agentWorkView(me, await readAgentWorkChange(me.organizationId)) };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/**
 * Sets Agent work (AC-011): Admins only, while the plan is active. The
 * change is kept with the value before and after, who made it and when
 * (setting_changes, 00481); one that can't be kept is undone, so the
 * setting never moves without its record. It counts from every agent run's
 * next change: the precedence reads it fresh for each call.
 */
export async function setAgentWork(value: string): Promise<SettingsResult> {
  try {
    const admin = await asAdmin();
    if (!admin.ok) return admin;
    if (!isAgentWork(value)) return { ok: false, failure: 'invalid' };
    const { me } = admin;
    // Null: never set (no row), so the default applied.
    const before = me.ctx.settings.agentWork ?? null;
    if (parseAgentWork(before) === value) return { ok: true };

    const write = (agentWork: string) =>
      supabaseAdmin
        .from('chat_settings')
        .upsert(
          { organization_id: me.organizationId, agent_work: agentWork, updated_by: me.userId },
          { onConflict: 'organization_id' },
        );
    const saved = await write(value);
    if (beforeAgentWork(saved.error)) return { ok: false, failure: 'unavailable' };
    if (saved.error) return { ok: false, failure: 'failed' };

    const logged = await supabaseAdmin.from('setting_changes').insert({
      organization_id: me.organizationId,
      setting_key: AGENT_WORK_KEY,
      old_value: before,
      new_value: value,
      changed_by: me.userId,
    });
    if (logged.error) {
      // Never a change without its record: the value before goes back.
      await write(parseAgentWork(before));
      return { ok: false, failure: beforeAgentWork(logged.error) ? 'unavailable' : 'failed' };
    }
    return { ok: true };
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
