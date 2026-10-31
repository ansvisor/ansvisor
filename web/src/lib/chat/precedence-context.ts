import { ORG_PLAN_COLUMNS } from '@/lib/guards/plan-guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Database } from '@/types/supabase';
import { planFactsFromOrgRow } from './plan-facts';
import {
  ADMIN_POLICIES,
  CHAT_MODES,
  CHAT_SURFACES,
  DEFAULT_CHAT_SETTINGS,
  parseTeamRole,
  type AdminPolicy,
  type ChatMode,
  type ChatSettings,
  type ChatSurface,
  type PrecedenceContext,
  type ToolCall,
} from './precedence';
import {
  EXECUTE_GROUPS,
  overBatchCard,
  type ChatTool,
  type ExecuteGroup,
} from './registry/define-tool';

/**
 * What the approval precedence decides on, read fresh for each tool call:
 * the person's live role, the workspace's plan, its Chat settings and the
 * person's "Don't ask again" ticks. Nothing is kept between calls, so a role,
 * a plan or a setting changed mid-run counts from the next call (CHAT-20 §4).
 * Read with the service role: these are the server's facts, and a scheduled
 * run has no session (CHAT-12). Server only.
 */

export interface PrecedenceRequest {
  userId: string;
  organizationId: string;
  /** Checked against CHAT_MODES: one it doesn't know is Ask me first. */
  mode: ChatMode;
  /** Checked against CHAT_SURFACES: one it doesn't know is MCP's, the closed side. */
  surface: ChatSurface;
  /** An injection attempt was found earlier in the run. */
  injectionDetected?: boolean;
}

type SettingsRow = Pick<
  Database['public']['Tables']['chat_settings']['Row'],
  'tool_policies' | 'full_auto_for_members' | 'dont_ask_again' | 'manager_execute_off'
>;

/** A chat_settings row as the precedence reads it; no row, the defaults. Unknown values are dropped. */
export function parseChatSettings(row: SettingsRow | null): ChatSettings {
  if (!row) return DEFAULT_CHAT_SETTINGS;
  const toolPolicies: Record<string, AdminPolicy> = {};
  const raw = row.tool_policies;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const policy = ADMIN_POLICIES.find((p) => p === value);
      if (policy) toolPolicies[key] = policy;
    }
  }
  return {
    toolPolicies,
    fullAutoForMembers: row.full_auto_for_members,
    dontAskAgain: row.dont_ask_again,
    managerExecuteOff: row.manager_execute_off.filter((group): group is ExecuteGroup =>
      EXECUTE_GROUPS.some((known) => known === group),
    ),
  };
}

/**
 * The brands a person may use. Every member uses every brand of their
 * workspace today, as the app does: sharing chosen brands with an Agency
 * partner is a Team feature of Wave 2, and until then they act as Analysts.
 */
export async function readBrandAccess(
  userId: string,
  organizationId: string,
): Promise<PrecedenceContext['brandAccess']> {
  void userId;
  void organizationId;
  return 'all';
}

/**
 * Whether a brand is the demo brand of sample data (brands.is_demo, 00380),
 * as the server's demo guard reads it. A brand that isn't found isn't one.
 */
export async function readBrandIsDemo(brandId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('is_demo')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the call's brand: ${error.message}`);
  return data?.is_demo === true;
}

/**
 * The context for one call, or null when the person can't act in that
 * workspace now: no profile, a profile in another workspace (removed or
 * moved), or a role that isn't a live one. A read that fails throws, so no
 * call is decided on missing facts.
 */
export async function readPrecedenceContext(
  req: PrecedenceRequest,
): Promise<PrecedenceContext | null> {
  const [profile, org, settings, choices, brandAccess] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', req.userId)
      .maybeSingle(),
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', req.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_settings')
      .select('tool_policies, full_auto_for_members, dont_ask_again, manager_execute_off')
      .eq('organization_id', req.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_auto_choices')
      .select('tool_key')
      .eq('user_id', req.userId)
      .eq('organization_id', req.organizationId),
    readBrandAccess(req.userId, req.organizationId),
  ]);
  for (const result of [profile, org, settings, choices]) {
    if (result.error) throw new Error(`Could not read Chat's permissions: ${result.error.message}`);
  }

  const role = parseTeamRole(profile.data?.role);
  if (!role || profile.data?.organization_id !== req.organizationId || !org.data) return null;

  return {
    organizationId: req.organizationId,
    role,
    plan: planFactsFromOrgRow(org.data),
    settings: parseChatSettings(settings.data),
    mode: CHAT_MODES.find((mode) => mode === req.mode) ?? 'ask_first',
    surface: CHAT_SURFACES.find((surface) => surface === req.surface) ?? 'mcp',
    autoChoices: new Set((choices.data ?? []).map((row) => row.tool_key)),
    brandAccess,
    injectionDetected: req.injectionDetected ?? false,
  };
}

/**
 * The brand a call is about, found in the person's workspace: the input's
 * brand_id, or the brand of the row its id names (the row's brandOf). Null
 * when the row is about no brand, when the input names none, or when the
 * brand isn't one of this workspace's, an id of another workspace's object
 * included: the precedence refuses a brand-bound call without one
 * (brand_scope), so 'all' never reaches past the workspace.
 */
export async function resolveCallBrand(
  tool: Pick<ChatTool, 'brandOf'>,
  input: Record<string, unknown>,
  organizationId: string,
): Promise<string | null> {
  const brandOf = tool.brandOf;
  if (!brandOf) return null;
  let brandId: unknown;
  if ('input' in brandOf) {
    brandId = input[brandOf.input];
  } else {
    const id = input[brandOf.idField];
    if (typeof id !== 'string' || !id) return null;
    // Every lookup table has brand_id; the client's types take one table at a time.
    const { data, error } = await supabaseAdmin
      .from(brandOf.lookup as 'actions')
      .select('brand_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the call's brand: ${error.message}`);
    brandId = data?.brand_id;
  }
  if (typeof brandId !== 'string' || !brandId) return null;
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the call's brand: ${error.message}`);
  return data ? brandId : null;
}

/**
 * A call as the precedence takes it: its brand found in the workspace, and
 * that brand's demo flag, read only for a brand in the person's scope (one
 * outside it is refused before its state matters); and whether it carries
 * more items than its row runs without a card.
 */
export async function readToolCall(
  ctx: PrecedenceContext,
  tool: Pick<ChatTool, 'brandOf' | 'batch' | 'alwaysCardWhen'>,
  input: Record<string, unknown>,
  tainted: boolean,
  /** The items the run's earlier calls of this row made (progress.writes). */
  before = 0,
): Promise<ToolCall> {
  const brandId = await resolveCallBrand(tool, input, ctx.organizationId);
  const inScope =
    brandId !== null && (ctx.brandAccess === 'all' || ctx.brandAccess.includes(brandId));
  return {
    brandId,
    brandIsDemo: inScope ? await readBrandIsDemo(brandId) : false,
    tainted,
    // Over its batch, or a choice that's the person's: a card in every mode.
    ...(overBatchCard(tool, input, before) || tool.alwaysCardWhen?.(input as never) === true
      ? { overBatch: true }
      : {}),
  };
}
