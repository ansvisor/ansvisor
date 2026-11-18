import type { TeamRole } from '@/components/providers/role-provider';
import { adsEnabled } from '@/lib/ads/flag';
import type { ChatTool, PlanGate, ToolFlags } from './define-tool';
import { ACTION_CENTER_TOOLS } from './action-center-tools';
import { ADS_READS, ADS_WRITES } from './ads-tools';
import { AGENT_CALL_TOOLS } from './agent-call-tools';
import { OPERATOR_READS, OPERATOR_WRITES } from './operator-tools';
import { AUDIT_TOOLS } from './audit-tools';
import { COMPETITOR_TOOLS } from './competitor-tools';
import { CONTENT_TOOLS } from './content-tools';
import { IMAGE_READS, IMAGE_WRITES } from './image-tools';
import { MCP_WRAPPED_READS } from './mcp-wrapped-reads';
import { PROMPT_TOOLS } from './prompt-tools';
import { READ_TOOLS } from './read-tools';
import { MEMORY_TOOLS } from './memory-tools';
import { REPORT_TOOLS } from './report-tools';
import { SCHEDULE_TOOLS } from './schedule-tools';
import { FOLLOW_UP_TOOLS } from './followup-tools';
import { SKILL_TOOLS } from './skill-tools';
import { SUBTASK_TOOLS } from './subtask-tools';
import { TOPIC_TOOLS } from './topic-tools';
import { VISIBILITY_EXTRA_READS } from './visibility-extra-tools';
import { WHY_TOOLS } from './why-tools';
import { WRITE_TOOLS } from './write-tools';
import { AREA_READS } from './areas';
import { NAVIGATION_READS } from './navigation';
import { WHATS_NEW_READS } from './whats-new';
import { READY_AGENT_READS } from './ready-agents';
import { TODAY_READS } from './today-tools';

/**
 * Every tool Chat may call (CHAT-20 §9). One without a row here isn't
 * available to Chat. The rows, with their internal and MCP names, stay on
 * the server: the approval checks, the run steps' `tool` column and the MCP
 * parity read them here. What a browser gets is registryCatalog().
 */
export const CHAT_TOOLS: readonly ChatTool[] = [
  ...READ_TOOLS,
  ...MCP_WRAPPED_READS,
  ...AREA_READS,
  ...NAVIGATION_READS,
  ...WHATS_NEW_READS,
  ...READY_AGENT_READS,
  ...TODAY_READS,
  ...OPERATOR_READS,
  ...SUBTASK_TOOLS,
  ...WHY_TOOLS,
  ...IMAGE_READS,
  ...ADS_READS,
  ...VISIBILITY_EXTRA_READS,
  ...WRITE_TOOLS,
  ...PROMPT_TOOLS,
  ...TOPIC_TOOLS,
  ...COMPETITOR_TOOLS,
  ...ACTION_CENTER_TOOLS,
  ...CONTENT_TOOLS,
  ...REPORT_TOOLS,
  ...AUDIT_TOOLS,
  ...IMAGE_WRITES,
  ...SCHEDULE_TOOLS,
  ...FOLLOW_UP_TOOLS,
  ...SKILL_TOOLS,
  ...MEMORY_TOOLS,
  ...AGENT_CALL_TOOLS,
  ...OPERATOR_WRITES,
  ...ADS_WRITES,
];

/**
 * The rows the install's pages list (Settings › Chat, What Chat can do,
 * Roles & access, the activity log's areas): every row, but Ads' only
 * while Ads is on (ADS_ENABLED), as their offerIn offers them to a run.
 */
export function listedTools(tools: readonly ChatTool[] = CHAT_TOOLS): readonly ChatTool[] {
  return adsEnabled() ? tools : tools.filter((tool) => tool.area !== 'ads');
}

/** The row of a tool, by its internal name; undefined for a name with no row. */
export function chatTool(name: string): ChatTool | undefined {
  return CHAT_TOOLS.find((tool) => tool.name === name);
}

/**
 * The row a catalog entry's `key` stands for: how the server reads which
 * tool a Settings page means (a policy change, say). Undefined for a key
 * with no row.
 */
export function chatToolByKey(key: string): ChatTool | undefined {
  return CHAT_TOOLS.find((tool) => tool.labelKey === key);
}

/**
 * A row as a page shows it: its decisions, under its label key, without
 * its names, schema, code or fixture.
 */
export type ToolCatalogEntry = Pick<
  ChatTool,
  'area' | 'class' | 'defaultPolicy' | 'maxPolicy' | 'minRole' | 'costClass' | 'route'
> & {
  /** The label key: `chatTools.{key}.name` in messages/en.json names it. */
  key: string;
  flags: ToolFlags;
  planGate: PlanGate | null;
  /** Roles left out of a row open to every role. */
  excludeRoles: TeamRole[];
};

/**
 * The registry as plain data for the browser: Settings › Chat, "What Chat
 * can do" and Roles & access (CHAT-20 §4a, §20). Every row, in registry
 * order, built from the rows on each call so it can't drift from what the
 * server checks. A tool's name, internal or MCP, never reaches a customer
 * (CHAT-03 item 22), so a row goes by its label key, which a page sends
 * back for chatToolByKey. Server code only (a server component or action
 * passes the result on): the rows import the functions they call.
 */
export function registryCatalog(tools: readonly ChatTool[] = listedTools()): ToolCatalogEntry[] {
  return tools.map((tool) => ({
    key: tool.labelKey,
    area: tool.area,
    class: tool.class,
    defaultPolicy: tool.defaultPolicy,
    maxPolicy: tool.maxPolicy,
    flags: { ...tool.flags },
    minRole: tool.minRole,
    excludeRoles: [...tool.excludeRoles],
    planGate: tool.planGate ? { ...tool.planGate } : null,
    costClass: tool.costClass,
    route: tool.route,
  }));
}
