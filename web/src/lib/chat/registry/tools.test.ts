// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { TeamRole } from '@/components/providers/role-provider';
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
vi.mock('@/lib/mcp/navigation', async (importOriginal) =>
  tracked.all('mcp/navigation', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/prompt-reads', async (importOriginal) =>
  tracked.all('mcp/prompt-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/overview-reads', async (importOriginal) =>
  tracked.all('mcp/overview-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/action-center-reads', async (importOriginal) =>
  tracked.all('mcp/action-center-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/google-reads', async (importOriginal) =>
  tracked.all('mcp/google-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/workspace-reads', async (importOriginal) =>
  tracked.all('mcp/workspace-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/pages', async (importOriginal) =>
  tracked.all('mcp/pages', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/actions/content', () => ({
  updateOpportunityStatus: tracked.track('actions/content.updateOpportunityStatus'),
}));
vi.mock('@/lib/actions/content-drafts', () => ({
  createContentDraft: tracked.track('actions/content-drafts.createContentDraft'),
  updateContentDraft: tracked.track('actions/content-drafts.updateContentDraft'),
}));
vi.mock('@/lib/actions/cms-send', () => ({
  sendDraftToCms: tracked.track('actions/cms-send.sendDraftToCms'),
}));
vi.mock('@/lib/actions/reports', () => ({
  createReport: tracked.track('actions/reports.createReport'),
}));
vi.mock('@/lib/actions/audits', () => ({
  startSiteAudits: tracked.track('actions/audits.startSiteAudits'),
  getAuditQuota: tracked.track('actions/audits.getAuditQuota'),
}));
vi.mock('@/lib/actions/prompt-suggestions', () => ({
  dismissSuggestion: tracked.track('actions/prompt-suggestions.dismissSuggestion'),
}));
vi.mock('@/lib/actions/chat-access-requests', () => ({
  requestAccess: tracked.track('actions/chat-access-requests.requestAccess'),
}));
vi.mock('@/lib/actions/prompt', () => ({
  addTopicPrompts: tracked.track('actions/prompt.addTopicPrompts'),
  pauseBrandPrompts: tracked.track('actions/prompt.pauseBrandPrompts'),
}));
vi.mock('@/lib/actions/topic', () => ({
  addBrandTopic: tracked.track('actions/topic.addBrandTopic'),
  renameBrandTopic: tracked.track('actions/topic.renameBrandTopic'),
}));
vi.mock('@/lib/actions/competitor', () => ({
  addCompetitors: tracked.track('actions/competitor.addCompetitors'),
  removeBrandCompetitor: tracked.track('actions/competitor.removeBrandCompetitor'),
}));

const { CHAT_TOOLS, chatTool, chatToolByKey, registryCatalog } = await import('./tools');
const { BRAND_LOOKUP_TABLES, FIXTURE_IDS, defineTool } = await import('./define-tool');
const { DEFAULT_CHAT_SETTINGS, allowedRoles, allowedTools } = await import('../precedence');
const { planFactsFromOrgRow } = await import('../plan-facts');

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
  brandOf: null,
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
    await run('add_prompts', { brand_id: brand, topic_id: item, prompts: [' crm pricing '] });
    await run('pause_prompts', { brand_id: brand, prompt_ids: [item] });
    await run('add_topic', { brand_id: brand, name: ' Pricing ' });
    await run('rename_topic', { topic_id: item, name: 'Plans' });
    await run('add_competitors', { brand_id: brand, competitors: [{ name: 'Peec AI' }] });
    await run('remove_competitor', { brand_id: brand, competitor_id: item });
    await run('update_draft', { draft_id: item, body_html: '<h1>FAQ</h1>' });
    await run('push_cms_draft', { draft_id: item, destination: 'wordpress' });
    await run('build_report', {
      brand_id: brand,
      template: 'competitor_benchmark',
      date_from: '2026-10-01',
      date_to: '2026-10-31',
    });
    await run('run_site_audit', { brand_id: brand, urls: [' https://acme.example/a '] });

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
      ['actions/prompt.addTopicPrompts', [brand, item, ['crm pricing']]],
      ['actions/prompt.pauseBrandPrompts', [brand, [item]]],
      ['actions/topic.addBrandTopic', [brand, 'Pricing']],
      ['actions/topic.renameBrandTopic', [item, 'Plans']],
      ['actions/competitor.addCompetitors', [brand, [{ name: 'Peec AI', domain: '' }]]],
      ['actions/competitor.removeBrandCompetitor', [brand, item]],
      [
        'actions/content-drafts.updateContentDraft',
        [item, { title: undefined, bodyHtml: '<h1>FAQ</h1>' }],
      ],
      ['actions/cms-send.sendDraftToCms', [item, 'wordpress']],
      [
        'actions/reports.createReport',
        [brand, { dateFrom: '2026-10-01', dateTo: '2026-10-31', template: 'competitor_benchmark' }],
      ],
      ['actions/audits.startSiteAudits', [brand, ['https://acme.example/a']]],
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
      } else if (tool.class === 'write' && (tool.flags.alwaysCard || tool.flags.costCard)) {
        // Ask your Admin, or a cost said first: a card in every mode (CHAT-20 rows 37, 80a).
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['ask', 'ask']);
      } else if (tool.class === 'write') {
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['ask_full_auto', 'always']);
      }
    }
  });

  it('opens daily work to every role and keeps the rest with Admins and Managers', () => {
    // The role model of 2026-10-29, as the server (#1763), MCP (#1762) and RLS have each write.
    const writes = CHAT_TOOLS.filter((t) => t.class !== 'read');
    expect(Object.fromEntries(writes.map((t) => [t.name, allowedRoles(t)]))).toEqual({
      create_draft: ['admin', 'manager', 'analyst', 'agency_partner'],
      update_opportunity: ['admin', 'manager'],
      dismiss_prompt_suggestion: ['admin', 'manager', 'analyst'],
      request_access: ['admin', 'manager', 'analyst', 'agency_partner'],
      // The brand's tracking setup (W2-06): Admins and Managers, as the app (00382, #1762).
      add_prompts: ['admin', 'manager'],
      pause_prompts: ['admin', 'manager'],
      add_topic: ['admin', 'manager'],
      rename_topic: ['admin', 'manager'],
      add_competitors: ['admin', 'manager'],
      remove_competitor: ['admin', 'manager'],
      // Content, reports and Site Audit (W2-07, DECISIONS T): an Analyst only saves drafts.
      update_draft: ['admin', 'manager'],
      push_cms_draft: ['admin', 'manager'],
      build_report: ['admin', 'manager'],
      run_site_audit: ['admin', 'manager'],
    });
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'read')) {
      expect(allowedRoles(tool)).toEqual(['admin', 'manager', 'analyst', 'agency_partner']);
    }
  });

  it('files the page create_draft saved as the draft keeps it: cleaned (CHAT-06)', () => {
    const draft = CHAT_TOOLS.find((t) => t.name === 'create_draft')!;
    const made = draft.deliverable!(
      {
        title: 'Pricing FAQ',
        body_html:
          '<h1>Pricing FAQ</h1><script>fetch("https://evil.example")</script><img src="https://ansvisor.com/a.png" onerror="alert(1)">',
      } as never,
      FIXTURE_IDS.brand,
    )!;
    expect(made.body).not.toMatch(/<script/i);
    expect(made.body).not.toMatch(/onerror/i);
    expect(made.body).toContain('<h1>Pricing FAQ</h1>');
  });

  it('says where every row that takes a brand or an object finds its brand', () => {
    const problems = CHAT_TOOLS.flatMap((tool) => {
      const fields = Object.keys(tool.inputSchema.shape);
      const ids = fields.filter((field) => field === 'id' || field.endsWith('_id'));
      const brandOf = tool.brandOf;
      if (fields.includes('brand_id')) {
        return brandOf && 'input' in brandOf ? [] : [`${tool.name}: takes brand_id`];
      }
      if (ids.length > 0) {
        return brandOf && 'lookup' in brandOf && ids.includes(brandOf.idField)
          ? []
          : [`${tool.name}: takes ${ids.join(', ')}, so its brand is looked up`];
      }
      return brandOf === null ? [] : [`${tool.name}: names no brand or object`];
    });
    expect(problems).toEqual([]);
    for (const tool of CHAT_TOOLS) {
      if (tool.brandOf && 'lookup' in tool.brandOf) {
        expect(BRAND_LOOKUP_TABLES).toContain(tool.brandOf.lookup);
      }
    }
    // A row can't name a field its input lacks.
    expect(() => defineTool({ ...readRow, brandOf: { input: 'brand_id' } })).toThrow(
      /brand_id, which its input lacks/,
    );
  });

  it('leaves roles out only of a row open to every role, and never an Admin', () => {
    const write = { ...readRow, class: 'write' as const, defaultPolicy: 'ask', maxPolicy: 'ask' };
    expect(
      defineTool({ ...write, excludeRoles: ['agency_partner'] } as never).excludeRoles,
    ).toEqual(['agency_partner']);
    expect(defineTool(readRow).excludeRoles).toEqual([]);
    expect(() =>
      defineTool({ ...write, minRole: 'manager', excludeRoles: ['analyst'] } as never),
    ).toThrow(/every role/);
    expect(() => defineTool({ ...write, excludeRoles: ['admin'] } as never)).toThrow(/Admin/);
  });

  it('keeps every execute at a click', () => {
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'execute')) {
      expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['click', 'click']);
    }
    const execute = defineTool({
      ...readRow,
      name: 'publish_test',
      class: 'execute',
      executeGroup: 'publishing',
    });
    expect([execute.defaultPolicy, execute.maxPolicy]).toEqual(['click', 'click']);
    expect(execute.executeGroup).toBe('publishing');
    // Every execute is in a go-live group, so the Managers' switch covers it.
    expect(() => defineTool({ ...readRow, class: 'execute' } as never)).toThrow(/go-live group/);
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
          'excludeRoles',
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

describe("the model's tool list on the registry's rows", () => {
  // CHAT-20 §21: the list equals the rows the role, plan, brand access and policy allow.
  const facts = (row: Parameters<typeof planFactsFromOrgRow>[0], cloud = true) => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', cloud ? 'true' : 'false');
    try {
      return planFactsFromOrgRow(row);
    } finally {
      vi.unstubAllEnvs();
    }
  };
  const list = (
    role: TeamRole,
    plan: ReturnType<typeof facts>,
    scope = { brandId: FIXTURE_IDS.brand as string | null, brandIsDemo: false },
    brandAccess: 'all' | string[] = 'all',
  ) =>
    allowedTools(
      CHAT_TOOLS,
      {
        organizationId: 'org-1',
        role,
        plan,
        settings: DEFAULT_CHAT_SETTINGS,
        mode: 'full_auto',
        surface: 'chat',
        autoChoices: new Set(),
        brandAccess,
        injectionDetected: false,
      },
      scope,
    ).map((tool) => tool.name);

  const reads = CHAT_TOOLS.filter((tool) => tool.class === 'read').map((tool) => tool.name);
  const writes = CHAT_TOOLS.filter((tool) => tool.class === 'write').map((tool) => tool.name);
  const starter = facts({ plan: 'starter', subscription_status: 'active' });
  const growth = facts({ plan: 'growth', subscription_status: 'active' });
  const withoutShopping = reads.filter((name) => name !== 'get_shopping_visibility');

  it('gives every role the reads its plan opens, and Analysts and Agency partners daily work only', () => {
    expect(list('analyst', starter)).toEqual([
      ...withoutShopping,
      'create_draft',
      'dismiss_prompt_suggestion',
      'request_access',
    ]);
    expect(list('agency_partner', growth)).toEqual([...reads, 'create_draft', 'request_access']);
    expect(list('manager', starter)).toEqual([...withoutShopping, ...writes]);
    expect(list('admin', growth)).toEqual([...reads, ...writes]);
    expect(list('analyst', facts(null, false))).toEqual([
      ...reads,
      'create_draft',
      'dismiss_prompt_suggestion',
      'request_access',
    ]);
  });

  it('lists reads only on a read-only workspace and on the demo brand', () => {
    const ended = facts({ plan: 'growth', subscription_status: 'canceled' });
    expect(list('admin', ended)).toEqual(withoutShopping);
    expect(list('admin', growth, { brandId: FIXTURE_IDS.brand, brandIsDemo: true })).toEqual(reads);
  });

  it("lists nothing for a brand outside the person's scope", () => {
    expect(list('agency_partner', growth, undefined, [])).toEqual([]);
    expect(list('agency_partner', growth, undefined, [FIXTURE_IDS.brand])).toEqual([
      ...reads,
      'create_draft',
      'request_access',
    ]);
  });
});
