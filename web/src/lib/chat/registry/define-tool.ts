import type { z } from 'zod';
import type { TeamRole } from '@/components/providers/role-provider';
import type { Feature, PlanId } from '@/config/plans';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Chat's tool registry (CHAT-20 §9): one row per tool Chat may call, saying
 * what it does, who may call it, on which plan and how a call is approved.
 * The same rows feed the model's tool list, the step labels (CHAT-03), the
 * Settings pages (registryCatalog) and the MCP parity checks. A capability
 * without a row isn't available to Chat ("silence = never"), and NEVER has
 * no class here: it is simply no row.
 *
 * A row only describes; the approval precedence that reads it (plan, role,
 * policy, mode) is checked on the server when a run calls the tool
 * (lib/chat/precedence.ts).
 */

/** What a call does (CHAT-20 §3): reads, changes data in Ansvisor, or goes live / leaves it. */
export const TOOL_CLASSES = ['read', 'write', 'execute'] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

/**
 * How a call is approved (CHAT-20 §5 step 4 and §9's policy codes): `on` a
 * read runs; `never` an Admin switched it off; `ask` a card in every mode;
 * `ask_full_auto` a card, except in Full auto ("Ask (auto allowed in Full
 * auto)"); `always` runs without a card; `click` an EXECUTE, which only the
 * user's click ever runs.
 */
export const TOOL_POLICIES = ['on', 'never', 'ask', 'ask_full_auto', 'always', 'click'] as const;
export type ToolPolicy = (typeof TOOL_POLICIES)[number];

/** The policies a WRITE row may start at or be raised to, least automatic first. */
export const WRITE_POLICIES = ['ask', 'ask_full_auto', 'always'] as const;
export type WritePolicy = (typeof WRITE_POLICIES)[number];

/**
 * The go-live groups an Admin may switch off for Managers (CHAT-20 §4
 * refinements): publishing, email and outreach, code and pull requests,
 * product feeds. Every EXECUTE row is in one.
 */
export const EXECUTE_GROUPS = ['publishing', 'email_outreach', 'code_prs', 'feeds'] as const;
export type ExecuteGroup = (typeof EXECUTE_GROUPS)[number];

/** The tables whose rows name their brand, for a row whose input names an object, not a brand. */
export const BRAND_LOOKUP_TABLES = [
  'actions',
  'competitors',
  'content_drafts',
  'content_opportunities',
  'prompt_results',
  'prompt_suggestions',
  'site_audits',
  'topics',
] as const;
export type BrandLookupTable = (typeof BRAND_LOOKUP_TABLES)[number];

/**
 * Where a call's brand comes from, so the brand scope and the demo rule see
 * it (CHAT-20 §15b): the input's brand_id, or the brand of the row the
 * input's id names. A row about the person or the workspace (a profile,
 * usage, the brand list) has none: brandOf null.
 */
export type BrandOf = { input: 'brand_id' } | { lookup: BrandLookupTable; idField: string };

/** CHAT-20 §9 cost: C0 no model, C1 a scoped read, C2 a model writing step, C3 heavy. */
export type CostClass = 'C0' | 'C1' | 'C2' | 'C3';

/** The product area a tool belongs to, as "What Chat can do" groups them (CHAT-20 §8). */
export type ToolArea =
  | 'account'
  | 'usage'
  | 'brands'
  | 'visibility'
  | 'prompts'
  | 'topics'
  | 'mentions'
  | 'citations'
  | 'competitors'
  | 'product_visibility'
  | 'ai_traffic'
  | 'site_audit'
  | 'action_center'
  | 'content'
  | 'reports';

/**
 * What the plan decides about a call (CHAT-20 §7), null when nothing. The
 * plan facts come from Billing at run time; self-hosted passes every gate.
 */
export interface PlanGate {
  /** The lowest plan that may call it, of PLAN_ORDER. */
  minPlan?: PlanId;
  /** The plan feature its page checks ("As live page"). */
  feature?: Feature;
  /** Open on every plan, but the data covers only the plan's platforms (allowedScrapers). */
  platforms?: true;
}

export interface ToolFlags {
  /** A WRITE that shows a card in every mode, Full auto included; its policy tops out at Ask. */
  alwaysCard: boolean;
  /** The cost estimate (percent of the AI limit) is shown before the first call. */
  costCard: boolean;
  /** A READ an Admin may switch off for the workspace (CHAT-20 §9 ¹). */
  adminMayTurnOff: boolean;
}

/**
 * Who a tool acts as: the signed-in user, resolved into the shape the MCP
 * data functions scope by (lib/agent/auth.ts resolveAgentAuth).
 */
export type ChatToolContext = McpAuthContext;

interface ToolFields<S extends z.ZodObject> {
  /** The internal name. Never shown to customers: steps show the label (CHAT-03). */
  name: string;
  area: ToolArea;
  /** What the model reads to pick the tool. */
  description: string;
  /** The lowest role that may call it: `analyst` means every role (CHAT-20 §20). */
  minRole: TeamRole;
  /**
   * Roles left out of a row open to every role, where the server and the
   * database refuse them (an Agency partner dismissing a prompt suggestion).
   * Never an Admin.
   */
  excludeRoles?: readonly TeamRole[];
  planGate: PlanGate | null;
  /** Where a call's brand comes from; null for a row about no brand. */
  brandOf: BrandOf | null;
  costClass: CostClass;
  /**
   * The key under `chatTools` in messages/en.json (`name` for Settings, `step`
   * for CHAT-03), and the row's key in the browser's catalog.
   */
  labelKey: string;
  /** The page in the app that shows the same thing (CHAT-19), or null. */
  route: string | null;
  /** The Ansvisor MCP Server tool that does the same work, or null. */
  mcpTool: string | null;
  /** Its row in CHAT-20 §9. */
  specRow: string;
  inputSchema: S;
  run(ctx: ChatToolContext, input: z.output<S>): Promise<unknown>;
  /**
   * A batch row (CHAT-20 §11b: add_prompts, add_competitors, pausing
   * prompts): the input field holding its items. A run's cap counts the
   * items, not the calls (§14), and a call with more than `askAbove` of them
   * shows a card in every mode (§9 row 22: "> 5 prompts: Ask").
   */
  batch?: { field: string; askAbove?: number };
  /**
   * What its card and step name as the target when the input's own words
   * don't (a list, an id): read from the data if need be, in the person's
   * words. Without it the engine reads the input's title, name or text.
   */
  target?(input: z.output<S>): string | null | Promise<string | null>;
  /**
   * What a call made, for the answer's output card and Files (CHAT-06
   * items 1, 9): filed as it is made. Null when the call made nothing to
   * file; a row without it makes nothing.
   */
  deliverable?(input: z.output<S>, output: unknown): ToolDeliverable | null;
  /** A valid input, for the registry's tests and the permission fixtures (CHAT-20 §19). */
  fixture: { input: z.input<S> };
}

/** Something a call made (CHAT-06 item 1): its card, and the file kept for it. */
export interface ToolDeliverable {
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  /** The formats it downloads in, its main one first. */
  formats: string[];
  /** Its canonical content, its type and its object's name in Files. */
  body: string;
  mimeType: string;
  fileName: string;
  /** Its card's Open: an app page (the Content Editor's draft). */
  href?: `/dashboard/${string}`;
  /** The Content draft it is ("Used in Content draft"). */
  contentDraftId?: string;
}

type ClassFields =
  | { class: 'read'; flags?: Partial<Pick<ToolFlags, 'adminMayTurnOff' | 'costCard'>> }
  | {
      class: 'write';
      defaultPolicy: WritePolicy;
      maxPolicy: WritePolicy;
      flags?: Partial<Pick<ToolFlags, 'alwaysCard' | 'costCard'>>;
    }
  | {
      class: 'execute';
      /** Its go-live group, which the Manager switch in Settings › Chat covers. */
      executeGroup: ExecuteGroup;
      flags?: Partial<Pick<ToolFlags, 'costCard'>>;
    };

export type ToolDefinition<S extends z.ZodObject> = ToolFields<S> & ClassFields;

export type ChatTool<S extends z.ZodObject = z.ZodObject> = Omit<ToolFields<S>, 'excludeRoles'> & {
  /** Roles left out of the row; empty for most. */
  excludeRoles: readonly TeamRole[];
  class: ToolClass;
  defaultPolicy: ToolPolicy;
  maxPolicy: ToolPolicy;
  flags: ToolFlags;
  /** An EXECUTE's go-live group; null on a read or a write. */
  executeGroup: ExecuteGroup | null;
};

/** Ids for the rows' fixtures: any 8-4-4-4-12 hex id passes the inputs' uuid check. */
export const FIXTURE_IDS = {
  brand: '11111111-1111-4111-8111-111111111111',
  item: '22222222-2222-4222-8222-222222222222',
} as const;

const writeRank = (policy: WritePolicy) => WRITE_POLICIES.indexOf(policy);

/**
 * A registry row, with the rules every row keeps checked as it is defined:
 * a READ runs (`on`), an EXECUTE is always a click, and a WRITE's default
 * never goes past its maximum, which an `always_card` WRITE keeps at Ask.
 */
export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ChatTool<S> {
  const flags: ToolFlags = {
    alwaysCard: false,
    costCard: false,
    adminMayTurnOff: false,
    ...def.flags,
  };
  if (def.brandOf) {
    const field = 'input' in def.brandOf ? def.brandOf.input : def.brandOf.idField;
    if (!(field in def.inputSchema.shape)) {
      throw new Error(`${def.name}: its brand comes from ${field}, which its input lacks`);
    }
  }
  if (def.batch && !(def.batch.field in def.inputSchema.shape)) {
    throw new Error(`${def.name}: its items are in ${def.batch.field}, which its input lacks`);
  }
  const excludeRoles = [...(def.excludeRoles ?? [])];
  if (excludeRoles.length > 0 && (def.minRole !== 'analyst' || excludeRoles.includes('admin'))) {
    throw new Error(`${def.name}: only a row open to every role leaves roles out, never an Admin`);
  }
  if (def.class === 'read') {
    if (flags.alwaysCard) throw new Error(`${def.name}: a read has no approval card`);
    return {
      ...def,
      defaultPolicy: 'on',
      maxPolicy: 'on',
      flags,
      excludeRoles,
      executeGroup: null,
    };
  }
  if (flags.adminMayTurnOff) throw new Error(`${def.name}: only a read is switched off`);
  if (def.class === 'execute') {
    if (flags.alwaysCard) throw new Error(`${def.name}: an execute is a click, not a card`);
    // Its type has no policy fields; one passed anyway can only ask for less than a click.
    if (
      ('defaultPolicy' in def && def.defaultPolicy !== 'click') ||
      ('maxPolicy' in def && def.maxPolicy !== 'click')
    ) {
      throw new Error(`${def.name}: an execute always needs the user's click`);
    }
    if (!EXECUTE_GROUPS.includes(def.executeGroup)) {
      throw new Error(`${def.name}: an execute belongs to a go-live group`);
    }
    return { ...def, defaultPolicy: 'click', maxPolicy: 'click', flags, excludeRoles };
  }
  if (def.class !== 'write') throw new Error('A tool is a read, a write or an execute');
  if (!WRITE_POLICIES.includes(def.defaultPolicy) || !WRITE_POLICIES.includes(def.maxPolicy)) {
    throw new Error(`${def.name}: a write is asked, asked unless Full auto, or always`);
  }
  if (writeRank(def.defaultPolicy) > writeRank(def.maxPolicy)) {
    throw new Error(`${def.name}: its default policy is past its maximum`);
  }
  if (flags.alwaysCard && def.maxPolicy !== 'ask') {
    throw new Error(`${def.name}: an always_card write never runs without a card`);
  }
  return { ...def, flags, excludeRoles, executeGroup: null };
}

/** How many items a call carries: its batch's length, or 1 for a row that isn't a batch. */
export function batchSize(
  tool: Pick<ChatTool, 'batch'>,
  input: Record<string, unknown>,
): number {
  if (!tool.batch) return 1;
  const items = input[tool.batch.field];
  return Array.isArray(items) ? items.length : 1;
}

/** A call with more items than its row runs without a card (CHAT-20 §9 row 22). */
export function overBatchCard(
  tool: Pick<ChatTool, 'batch'>,
  input: Record<string, unknown>,
): boolean {
  const above = tool.batch?.askAbove;
  return above !== undefined && batchSize(tool, input) > above;
}
