// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatTool } from './define-tool';
import { clientEventProblems, type ChatEvent } from '../events';

/**
 * The registry's rows (CHAT-20 §9, §21): each has its label and a fixture,
 * names are unique, an EXECUTE is always a click, and each row calls the
 * function it names — a READ the MCP data function, a WRITE the server
 * action the app's own button calls — with nothing between.
 */

const calls = vi.hoisted(() => [] as { from: string; args: unknown[] }[]);
const tracked = vi.hoisted(() => {
  const track = (from: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ from, args });
      return { from };
    });
  return {
    track,
    /** Every function a module exports, tracked; its constants as they are. */
    all: (prefix: string, mod: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(mod).map(([key, value]) => [
          key,
          typeof value === 'function' ? track(`${prefix}.${key}`) : value,
        ]),
      ),
  };
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/data', async (importOriginal) =>
  tracked.all('mcp/data', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/content', async (importOriginal) =>
  tracked.all('mcp/content', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/mentions', async (importOriginal) =>
  tracked.all('mcp/mentions', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/account', async (importOriginal) =>
  tracked.all('mcp/account', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/actions/content', () => ({
  updateOpportunityStatus: tracked.track('actions/content.updateOpportunityStatus'),
}));
vi.mock('@/lib/actions/content-drafts', () => ({
  createContentDraft: tracked.track('actions/content-drafts.createContentDraft'),
}));
vi.mock('@/lib/actions/prompt-suggestions', () => ({
  dismissSuggestion: tracked.track('actions/prompt-suggestions.dismissSuggestion'),
}));

const { CHAT_TOOLS, chatTool, chatToolByKey, registryCatalog } = await import('./tools');
const { FIXTURE_IDS, defineTool } = await import('./define-tool');

const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  role: 'admin' as const,
};
const labels = (messages as Record<string, unknown>).chatTools as Record<string, unknown>;

/** What keeps a row out of the registry: a missing label, a fixture its schema refuses. */
function rowProblems(tool: ChatTool, chatTools: Record<string, unknown> = labels): string[] {
  const problems: string[] = [];
  const label = chatTools?.[tool.labelKey] as Record<string, unknown> | undefined;
  for (const part of ['name', 'step']) {
    const text = label?.[part];
    if (typeof text !== 'string' || !text.trim()) {
      problems.push(`no chatTools.${tool.labelKey}.${part} in en.json`);
    }
  }
  if (!tool.fixture || !('input' in tool.fixture)) problems.push('no fixture');
  else if (!tool.inputSchema.safeParse(tool.fixture.input).success) {
    problems.push("its fixture doesn't pass its input schema");
  }
  return problems;
}

/** The app's page for a route: a folder per segment, or a [param] folder for any. */
const dashboardDir = path.join(__dirname, '../../../app/[locale]/(dashboard)');
function pageExists(route: string): boolean {
  let dirs = [dashboardDir];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const children = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
      return children
        .filter((d) => d.name === segment || /^\[[^.\]]+\]$/.test(d.name))
        .map((d) => path.join(dir, d.name));
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

const readRow = {
  name: 'read_test',
  class: 'read' as const,
  area: 'brands' as const,
  description: 'test',
  minRole: 'analyst' as const,
  planGate: null,
  costClass: 'C0' as const,
  labelKey: 'brands',
  route: null,
  mcpTool: null,
  specRow: '0',
  inputSchema: z.object({}),
  run: async () => null,
  fixture: { input: {} },
};

beforeEach(() => {
  calls.length = 0;
});

describe('the Chat tool registry', () => {
  it('has a label and a valid fixture on every row', () => {
    const problems = CHAT_TOOLS.flatMap((tool) =>
      rowProblems(tool).map((problem) => `${tool.name}: ${problem}`),
    );
    expect(problems).toEqual([]);
  });

  it('fails a row whose label is missing or whose fixture is', () => {
    const row = defineTool({ ...readRow, labelKey: 'notALabel' });
    expect(rowProblems(row)).toEqual([
      'no chatTools.notALabel.name in en.json',
      'no chatTools.notALabel.step in en.json',
    ]);
    const noFixture = { ...defineTool(readRow), fixture: undefined } as unknown as ChatTool;
    expect(rowProblems(noFixture)).toEqual(['no fixture']);
    const badFixture = defineTool({
      ...readRow,
      inputSchema: z.object({ brand_id: z.string() }),
      fixture: { input: {} as { brand_id: string } },
    });
    expect(rowProblems(badFixture)).toEqual(["its fixture doesn't pass its input schema"]);
  });

  it('gives every tool its own name and its own label', () => {
    const names = CHAT_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const keys = CHAT_TOOLS.map((tool) => tool.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the tools' names out of the label keys, which reach the browser", () => {
    // Every page gets all of en.json; a function name never reaches a customer (CHAT-03).
    const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const tool of CHAT_TOOLS) {
      expect(tool.labelKey).not.toContain('_');
      expect(tool.labelKey).not.toBe(camel(tool.name));
    }
  });

  it('finds a row by its name, and nothing for a name without one', () => {
    expect(chatTool('list_brands')?.class).toBe('read');
    expect(chatTool('delete_brand')).toBeUndefined();
  });

  it('points every route at a page of the app', () => {
    const missing = CHAT_TOOLS.filter((tool) => tool.route && !pageExists(tool.route));
    expect(missing.map((tool) => `${tool.name} → ${tool.route}`)).toEqual([]);
  });

  it.each(CHAT_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s calls its own function with the fixture, and returns what it returns',
    async (_name, tool) => {
      const result = await tool.run(ctx, tool.inputSchema.parse(tool.fixture.input));
      expect(calls).toHaveLength(1);
      expect(result).toEqual({ from: calls[0].from });
      if (tool.class === 'read') {
        // The MCP data functions, scoped to the signed-in member's organization.
        expect(calls[0].from).toMatch(/^mcp\//);
        expect(calls[0].args[0]).toBe(ctx);
      } else {
        // The app's server actions, through the member's own session.
        expect(calls[0].from).toMatch(/^actions\//);
      }
    },
  );

  it('hands the app the same arguments its pages pass', async () => {
    const run = (name: string, input: unknown) => {
      const tool = chatTool(name)!;
      return tool.run(ctx, tool.inputSchema.parse(input));
    };
    const { brand, item } = FIXTURE_IDS;

    await run('dismiss_prompt_suggestion', { suggestion_id: item });
    await run('update_opportunity', {
      opportunity_id: item,
      status: 'dismissed',
      reason: 'wrong_angle',
    });
    // A reason goes only with a dismissal.
    await run('update_opportunity', {
      opportunity_id: item,
      status: 'reviewed',
      reason: 'wrong_angle',
    });
    await run('create_draft', {
      brand_id: brand,
      title: ' Pricing FAQ ',
      page_type: 'docs_faq',
      source: { kind: 'opportunity', id: item },
    });

    expect(calls.map((call) => [call.from, call.args])).toEqual([
      ['actions/prompt-suggestions.dismissSuggestion', [item]],
      ['actions/content.updateOpportunityStatus', [item, 'dismissed', 'wrong_angle']],
      ['actions/content.updateOpportunityStatus', [item, 'reviewed', undefined]],
      [
        'actions/content-drafts.createContentDraft',
        [
          brand,
          {
            method: 'create',
            title: 'Pricing FAQ',
            pageType: 'docs_faq',
            typePicked: false,
            source: { kind: 'opportunity', id: item },
            bodyHtml: undefined,
            sourceUrl: undefined,
          },
        ],
      ],
    ]);
  });

  it('refuses what the update and draft writes are not for', () => {
    const update = chatTool('update_opportunity')!.inputSchema;
    // Only reviewed or dismissed (CHAT-20 §9 row 49), not the rest of the workflow.
    expect(update.safeParse({ opportunity_id: FIXTURE_IDS.item, status: 'done' }).success).toBe(
      false,
    );
    const draft = chatTool('create_draft')!.inputSchema;
    const base = {
      brand_id: FIXTURE_IDS.brand,
      title: 'Pricing',
      page_type: 'pricing',
      source: { kind: 'content' },
    };
    expect(draft.safeParse(base).success).toBe(true);
    expect(draft.safeParse({ ...base, source_url: 'ftp://example.com' }).success).toBe(false);
    expect(draft.safeParse({ ...base, page_type: 'press_release' }).success).toBe(false);
  });
});

describe('approval policies', () => {
  it('lets a read run, and starts every write here at Ask (auto allowed in Full auto)', () => {
    for (const tool of CHAT_TOOLS) {
      if (tool.class === 'read') {
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['on', 'on']);
      } else if (tool.class === 'write') {
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['ask_full_auto', 'always']);
        // Analysts and Agency partners are read-only (CHAT-20 §4).
        expect(['admin', 'manager']).toContain(tool.minRole);
      }
    }
  });

  it('keeps every execute at a click', () => {
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'execute')) {
      expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['click', 'click']);
    }
    const execute = defineTool({ ...readRow, name: 'publish_test', class: 'execute' });
    expect([execute.defaultPolicy, execute.maxPolicy]).toEqual(['click', 'click']);
    // A row that asks for less than a click isn't defined at all.
    expect(() =>
      defineTool({ ...readRow, class: 'execute', defaultPolicy: 'always' } as never),
    ).toThrow(/click/);
    expect(() =>
      defineTool({ ...readRow, class: 'execute', maxPolicy: 'ask_full_auto' } as never),
    ).toThrow(/click/);
  });

  it("refuses a write's policy past what its flags allow", () => {
    const write = { ...readRow, class: 'write' as const };
    expect(() =>
      defineTool({ ...write, defaultPolicy: 'always', maxPolicy: 'ask_full_auto' }),
    ).toThrow(/past its maximum/);
    // An always_card write shows its card in every mode, Full auto too (CHAT-20 §3a).
    expect(() =>
      defineTool({
        ...write,
        defaultPolicy: 'ask',
        maxPolicy: 'ask_full_auto',
        flags: { alwaysCard: true },
      }),
    ).toThrow(/without a card/);
    expect(
      defineTool({ ...write, defaultPolicy: 'ask', maxPolicy: 'ask', flags: { alwaysCard: true } })
        .flags,
    ).toEqual({ alwaysCard: true, costCard: false, adminMayTurnOff: false });
    expect(() => defineTool({ ...write, defaultPolicy: 'on', maxPolicy: 'on' } as never)).toThrow(
      /asked/,
    );
  });
});

describe('registryCatalog', () => {
  it('lists every row as plain data, in registry order, with no code in it', () => {
    const catalog = registryCatalog();
    expect(catalog.map((entry) => entry.key)).toEqual(CHAT_TOOLS.map((tool) => tool.labelKey));
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    for (const entry of catalog) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'area',
          'class',
          'costClass',
          'defaultPolicy',
          'flags',
          'key',
          'maxPolicy',
          'minRole',
          'planGate',
          'route',
        ].sort(),
      );
    }
  });

  it('never carries a tool name to the browser, internal or MCP', () => {
    // CHAT-03 item 22: no name in any value, and no key A1's event rule refuses.
    const names = new Set(CHAT_TOOLS.flatMap((tool) => [tool.name, tool.mcpTool ?? '']));
    const values: unknown[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
      else values.push(value);
    };
    const catalog = registryCatalog();
    walk(catalog);
    expect(values.filter((value) => typeof value === 'string' && names.has(value))).toEqual([]);
    const asEvent = { type: 'next_moves', seq: 1, data: { catalog } } as unknown as ChatEvent;
    expect(clientEventProblems(asEvent)).toEqual([]);
  });

  it('leads a key from the browser back to its row on the server', () => {
    for (const tool of CHAT_TOOLS) expect(chatToolByKey(tool.labelKey)).toBe(tool);
    expect(chatToolByKey('list_brands')).toBeUndefined();
  });

  it('describes a row as it is defined, without sharing its objects', () => {
    const row = defineTool({ ...readRow, planGate: { feature: 'prompt_volumes' } });
    const [entry] = registryCatalog([row]);
    expect(entry).toMatchObject({
      key: 'brands',
      class: 'read',
      defaultPolicy: 'on',
      planGate: { feature: 'prompt_volumes' },
      flags: { alwaysCard: false, costCard: false, adminMayTurnOff: false },
    });
    expect(entry.planGate).not.toBe(row.planGate);
    expect(entry.flags).not.toBe(row.flags);
  });
});
