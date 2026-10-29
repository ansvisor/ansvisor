import type { ChatTool, PlanGate, ToolFlags } from './define-tool';
import { READ_TOOLS } from './read-tools';
import { WRITE_TOOLS } from './write-tools';

/** Every tool Chat may call (CHAT-20 §9). One without a row here isn't available to Chat. */
export const CHAT_TOOLS: readonly ChatTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

/** The row of a tool, by its internal name; undefined for a name with no row. */
export function chatTool(name: string): ChatTool | undefined {
  return CHAT_TOOLS.find((tool) => tool.name === name);
}

/** A row as Settings shows it: its decisions, without its schema, code or fixture. */
export type ToolCatalogEntry = Pick<
  ChatTool,
  | 'name'
  | 'area'
  | 'class'
  | 'defaultPolicy'
  | 'maxPolicy'
  | 'minRole'
  | 'costClass'
  | 'labelKey'
  | 'route'
  | 'mcpTool'
  | 'specRow'
> & { flags: ToolFlags; planGate: PlanGate | null };

/**
 * The registry as plain data, for Settings › Chat, "What Chat can do" and
 * Roles & access (CHAT-20 §4a, §20): every row, in registry order, with
 * nothing that can't go through JSON. Built from the rows on each call, so
 * it can't drift from what the server checks. Server code only (a server
 * component or action passes the result on): the rows import the data
 * functions and server actions they call.
 *
 * `name` is internal (CHAT-03): a page keys its rows by it but shows the
 * label (`chatTools.{labelKey}.name` in messages/en.json), never the name.
 */
export function registryCatalog(tools: readonly ChatTool[] = CHAT_TOOLS): ToolCatalogEntry[] {
  return tools.map((tool) => ({
    name: tool.name,
    area: tool.area,
    class: tool.class,
    defaultPolicy: tool.defaultPolicy,
    maxPolicy: tool.maxPolicy,
    flags: { ...tool.flags },
    minRole: tool.minRole,
    planGate: tool.planGate ? { ...tool.planGate } : null,
    costClass: tool.costClass,
    labelKey: tool.labelKey,
    route: tool.route,
    mcpTool: tool.mcpTool,
    specRow: tool.specRow,
  }));
}
