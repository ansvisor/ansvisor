// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Chat and the Ansvisor MCP Server do the same work through the same rows
 * (CHAT-20 §17): every MCP tool a row names is registered on the server, and
 * the server agrees with the row on whether it only reads. Every MCP read
 * has a Chat row, or says why only MCP has it (MCP_ONLY_READS), so the two
 * can't drift apart again (the owner's plan of 2026-11-16, step 6a).
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
// The write rows' server actions; nothing here calls them.
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/content-drafts', () => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ dismissSuggestion: vi.fn() }));

const { CHAT_TOOLS } = await import('./tools');
const { createMcpServer } = await import('@/lib/mcp/server');
const { isReadTool } = await import('@/lib/mcp/subscription-gate');
const { MCP_ONLY_READS } = await import('./mcp-wrapped-reads');

type McpTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
let mcpTools: Map<string, McpTool>;

beforeAll(async () => {
  // role: the MCP context's since #1762; a const, so it compiles before it too.
  const auth = {
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all' as const,
    role: 'admin' as const,
  };
  const server = createMcpServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  mcpTools = new Map(tools.map((tool) => [tool.name, tool]));
});

const mapped = CHAT_TOOLS.filter((tool) => tool.mcpTool);

/** Whether an MCP tool only reads: the server's own split, or its readOnlyHint. */
const mcpRead = (tool: McpTool) => isReadTool(tool.name) || tool.annotations?.readOnlyHint === true;

/** The MCP reads with no Chat read row and no reason to be MCP's only. */
function uncoveredReads(
  tools: readonly McpTool[],
  rows: readonly { class: string; mcpTool: string | null }[],
  mcpOnly: Readonly<Record<string, string>>,
): string[] {
  const inChat = new Set(rows.filter((row) => row.class === 'read').map((row) => row.mcpTool));
  return tools
    .filter((tool) => mcpRead(tool) && !inChat.has(tool.name) && !(tool.name in mcpOnly))
    .map((tool) => tool.name);
}

describe('the registry against the MCP Server', () => {
  it('names only MCP tools the server registers', () => {
    const unknown = mapped.filter((tool) => !mcpTools.has(tool.mcpTool!));
    expect(unknown.map((tool) => `${tool.name} → ${tool.mcpTool}`)).toEqual([]);
  });

  it('maps a read to an MCP read and a write to an MCP write', () => {
    // isReadTool is the server's own split: what stays open on a read-only workspace.
    const crossed = mapped.filter((tool) => isReadTool(tool.mcpTool!) !== (tool.class === 'read'));
    expect(crossed.map((tool) => `${tool.name} (${tool.class}) → ${tool.mcpTool}`)).toEqual([]);
  });

  it("agrees with the MCP tools' readOnlyHint wherever they state one", () => {
    // On main only a few tools state it; #1732 adds it to every tool, and then this covers all.
    const disagree = mapped.filter((tool) => {
      const hint = mcpTools.get(tool.mcpTool!)?.annotations?.readOnlyHint;
      return hint !== undefined && hint !== (tool.class === 'read');
    });
    expect(disagree.map((tool) => `${tool.name} → ${tool.mcpTool}`)).toEqual([]);
  });

  it('gives Chat every MCP read, or says why only MCP has it', () => {
    expect(uncoveredReads([...mcpTools.values()], CHAT_TOOLS, MCP_ONLY_READS)).toEqual([]);
  });

  it('fails on a new MCP read with neither a Chat row nor a reason', () => {
    const added = { name: 'get_new_thing', inputSchema: { type: 'object' as const } };
    const tools = [...mcpTools.values(), added];
    expect(uncoveredReads(tools, CHAT_TOOLS, MCP_ONLY_READS)).toEqual(['get_new_thing']);
    // A tool stating readOnlyHint is a read whatever its name.
    const hinted = { ...added, name: 'find_thing', annotations: { readOnlyHint: true } };
    expect(uncoveredReads([hinted], [], {})).toEqual(['find_thing']);
    expect(uncoveredReads([added], [], { get_new_thing: 'An export format.' })).toEqual([]);
  });

  it('keeps MCP_ONLY_READS to MCP reads Chat has no row for, each with its reason', () => {
    for (const [name, why] of Object.entries(MCP_ONLY_READS)) {
      const tool = mcpTools.get(name);
      expect(tool && mcpRead(tool), `${name} is an MCP read`).toBe(true);
      expect(
        mapped.some((row) => row.mcpTool === name),
        `${name} has no Chat row`,
      ).toBe(false);
      expect(why.trim().split(/\s+/).length, `${name} says why`).toBeGreaterThan(5);
    }
  });
});
