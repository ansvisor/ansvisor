import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { brandScopedTables } from './demo/coverage.js';

/**
 * Brand access (00388) reaches every brand table through the brands table
 * (00389). A table's policy that reads its brand from public.brands follows
 * the brands policies, because PostgreSQL applies them inside that subquery
 * too; one that calls the access rule (can_access_brand, user_brand_ids)
 * applies it itself. A policy that looks only at the organization or the
 * person lets a Selected-brands person read every brand's rows.
 *
 * Read from the migrations: a brand table (one with a brand_id) whose client
 * policy does neither fails here, unless it is on the list below of tables a
 * later migration fixes. Policies for the service role, policies that refuse
 * everyone (`false`) and restrictive ones (they only narrow) don't count.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const migrations = files.map((file) => readFileSync(new URL(file, dir), 'utf8'));

/**
 * Brand tables whose policies look only at the organization or the person
 * (BRAND-ACCESS PR 3 makes each one answer to the brand's access). Nobody has
 * Selected brands until the Team PR, so none of them shows anyone more today.
 */
const PR_3 = {
  agent_conversations: "The old Agent's chats: the person's own, any brand of theirs.",
  chat_access_requests:
    "A person's request to their admins: the organization's admins, or the person.",
  chat_activity_log: "Chat's change log: the organization's admins, or the person who made it.",
  chat_agent_runs: "An agent's runs: anyone who sees the agent, an admin, or the acting person.",
  chat_conversations: 'A shared chat: anyone in the organization, whatever its brand.',
  chat_files: "Chat's filed files: anyone in the organization.",
  chat_suggestion_feeds: "A person's daily suggestions switch: theirs, in their organization.",
  chat_suggestions: "A person's daily suggestions: theirs, in their organization.",
  chat_why_analyses: 'Why did it move analyses: through their chat (chat_conversations).',
  content_draft_deliveries: 'Drafts sent out (titles, published URLs): anyone in the organization.',
  prompt_usage_counters: "A brand's prompt usage counts: anyone in the organization.",
  ship_events: 'Changes that went live: anyone in the organization.',
};

/**
 * Brand tables with no client policy: only the server (service role) reads and
 * writes them, and checks brand access itself (BRAND-ACCESS PR 7).
 */
const SERVER_ONLY = [
  'action_candidates',
  'action_task_runs',
  'brand_fact_pages',
  'chat_tool_cache',
  'citation_rollup_rebuilds',
  'cited_page_features',
  'cloro_pending_tasks',
  'competitor_timeline_scans',
  'insights_rollup_rebuilds',
  'jobs',
  'mentions_entities_daily',
  'mentions_perception_snapshots',
  'mentions_terms_daily',
  'prompt_improve_suggestions',
  'signal_runs',
  'suggestion_relevance_usage',
];

/** Roles that bypass RLS: a policy for them only is the server's. */
const SERVER_ROLES = new Set(['service_role', 'postgres', 'supabase_admin']);

/** Reads its brand through public.brands, or calls the access rule. */
const REACHES_BRAND =
  /\b(?:from|join)\s+\(?\s*(?:public\.)?brands\b|\b(?:public\.)?(?:can_access_brand|user_brand_ids)\s*\(/i;

const name = (raw) =>
  raw
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();

const roleList = (raw) =>
  raw
    .replace(/"/g, '')
    .toLowerCase()
    .split(',')
    .map((role) => role.trim());

/**
 * A DO block that runs the same statements for a list of tables (00278's
 * catalog policies), written out as the statements it runs.
 */
function expandLoops(sql) {
  return sql.replace(/\bdo \$(\w*)\$([\s\S]*?)\$\1\$/gi, (block, _tag, body) => {
    const loop = body.match(/foreach (\w+) in array array\[([^\]]*)\]/i);
    if (!loop) return block;
    const tables = [...loop[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const formats = [
      ...body.matchAll(/execute format\(\s*'((?:[^']|'')*)'((?:\s*,[^,;)]+)*)\s*\)/gi),
    ];
    const value = (arg, table) =>
      arg
        .split('||')
        .map((part) => part.trim())
        .map((part) => (part === loop[1] ? table : part.replace(/^'|'$/g, '')))
        .join('');
    const out = [];
    for (const table of tables) {
      for (const [, template, args] of formats) {
        const values = args
          .split(',')
          .slice(1)
          .map((arg) => value(arg, table));
        let i = 0;
        out.push(template.replace(/''/g, "'").replace(/%I/g, () => `"${values[i++]}"`));
      }
    }
    return `${out.join(';\n')};`;
  });
}

/** A migration's statements on one line each: comments and function bodies left out. */
function statements(sql) {
  return expandLoops(sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim());
}

/**
 * The policies and the tables with RLS on, once every migration has run, as
 * pg_policies and pg_class would show them.
 */
function policyState() {
  const policies = new Map();
  const rls = new Set();
  const of = (table) => {
    if (!policies.has(table)) policies.set(table, new Map());
    return policies.get(table);
  };
  for (const sql of migrations) {
    for (const text of statements(sql)) {
      let m;
      if ((m = text.match(/^create policy ("[^"]+"|\S+) on ([\w."]+) ?(.*)$/i))) {
        const rest = m[3].replace(/"/g, '');
        const head = rest.split(/\b(?:using|with check)\b/i)[0];
        of(name(m[2])).set(name(m[1]), {
          command: (
            head.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? 'all'
          ).toLowerCase(),
          restrictive: /\bas restrictive\b/i.test(head),
          roles: roleList(head.match(/\bto ([\w, ]+?)\s*$/i)?.[1] ?? 'public'),
          body: rest.slice(head.length),
        });
      } else if ((m = text.match(/^drop policy (?:if exists )?("[^"]+"|\S+) on ([\w."]+)/i))) {
        policies.get(name(m[2]))?.delete(name(m[1]));
      } else if ((m = text.match(/^alter policy ("[^"]+"|\S+) on ([\w."]+) (.*)$/i))) {
        const kept = policies.get(name(m[2]));
        const found = kept?.get(name(m[1]));
        const to = m[3].match(/^to ([\w", ]+?)(?: using| with check|$)/i);
        const body = m[3].match(/\b(using|with check)\b.*$/i);
        const renamed = m[3].match(/^rename to ("[^"]+"|\S+)/i);
        if (found && to) found.roles = roleList(to[1]);
        if (found && body) found.body = body[0].replace(/"/g, '');
        if (found && renamed) {
          kept.delete(name(m[1]));
          kept.set(name(renamed[1]), found);
        }
      } else if (
        (m = text.match(/^drop table (?:if exists )?([\w.", ]+?)(?: cascade| restrict)?$/i))
      ) {
        for (const table of m[1].split(',')) {
          policies.delete(name(table.trim()));
          rls.delete(name(table.trim()));
        }
      } else if (
        (m = text.match(/^alter table (?:if exists )?(?:only )?([\w."]+) rename to ([\w."]+)$/i))
      ) {
        const kept = policies.get(name(m[1]));
        policies.delete(name(m[1]));
        if (kept) policies.set(name(m[2]), kept);
        if (rls.delete(name(m[1]))) rls.add(name(m[2]));
      } else if (
        (m = text.match(
          /^alter table (?:if exists )?(?:only )?([\w."]+) (enable|disable) row level security$/i,
        ))
      ) {
        if (m[2].toLowerCase() === 'enable') rls.add(name(m[1]));
        else rls.delete(name(m[1]));
      }
    }
  }
  return { policies, rls };
}

const { policies, rls } = policyState();
const brandTables = brandScopedTables(migrations);

/** The policies that let a signed-in person (or anon) in: permissive, for a client role, not `false`. */
function clientPolicies(table) {
  return [...(policies.get(table)?.values() ?? [])].filter(
    (p) =>
      !p.restrictive &&
      p.roles.some((role) => !SERVER_ROLES.has(role)) &&
      !/^(?:using \(\s*false\s*\)\s*)?(?:with check \(\s*false\s*\)\s*)?$/i.test(p.body.trim()),
  );
}

/** A policy's `using (…)` and `with check (…)` conditions. */
function conditions(body) {
  const found = [];
  const start = /\b(using|with check) \(/gi;
  let m;
  while ((m = start.exec(body))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')' && --depth === 0) break;
    }
    found.push(body.slice(m.index + m[0].length, i));
    start.lastIndex = i + 1;
  }
  return found;
}

/** Each condition of the policy reads the brand through brands or the access rule (or is false). */
function reachesBrand(p) {
  const found = conditions(p.body);
  return (
    found.length > 0 &&
    found.every((condition) => condition.trim() === 'false' || REACHES_BRAND.test(condition))
  );
}

const reaching = [];
const notReaching = [];
const serverOnly = [];
for (const table of brandTables) {
  const client = clientPolicies(table);
  if (client.length === 0) serverOnly.push(table);
  else if (client.every(reachesBrand)) reaching.push(table);
  else notReaching.push(table);
}

describe('the brands policies (00389)', () => {
  const brands = policies.get('brands');
  const byCommand = (command) => [...brands.values()].filter((p) => p.command === command);

  it('keep one policy per command', () => {
    expect([...brands.values()].map((p) => p.command).sort()).toEqual([
      'delete',
      'insert',
      'select',
      'update',
    ]);
  });

  it('let a person read only the brands they can access', () => {
    const [read] = byCommand('select');
    expect(read.roles).toEqual(['authenticated']);
    // All brands: the row's own organization, so a brand being added reads back.
    expect(read.body).toMatch(
      /organization_id in \( select p\.organization_id from public\.profiles p where p\.id = auth\.uid\(\) and \(p\.role = 'admin' or p\.brand_scope = 'all'\) \)/,
    );
    // Selected brands: the access rule, once per query.
    expect(read.body).toMatch(/ or id in \(select public\.user_brand_ids\(\)\)/);
    // Looking the brand up by id would refuse a brand being added (insert … returning).
    expect(read.body).not.toMatch(/can_access_brand/);
  });

  it('let a person change or delete only the brands they can access, with the roles as before', () => {
    const [update] = byCommand('update');
    const [remove] = byCommand('delete');
    for (const write of [update, remove]) {
      expect(write.roles).toEqual(['authenticated']);
      expect(write.body).toMatch(/not is_demo/);
      expect(write.body).toMatch(/and id in \(select public\.user_brand_ids\(\)\)/);
    }
    const managers =
      /profiles\.role = any \(array\['admin'::public\.user_role, 'manager'::public\.user_role\]\)/;
    expect(update.body).toMatch(/^using \(.*\) with check \(.*\)$/);
    expect(update.body.match(new RegExp(managers.source, 'g'))).toHaveLength(2);
    expect(update.body.match(/user_brand_ids/g)).toHaveLength(2);
    expect(remove.body).toMatch(/profiles\.role = 'admin'::public\.user_role/);
  });

  it('leave adding a brand to admins and managers of the organization, as before', () => {
    const [add] = byCommand('insert');
    expect(add.body).toMatch(/^with check \( not is_demo and organization_id in \(/);
    expect(add.body).toMatch(
      /profiles\.role = any \(array\['admin'::public\.user_role, 'manager'::public\.user_role\]\)/,
    );
    expect(add.body).not.toMatch(/user_brand_ids|can_access_brand/);
  });
});

describe('every brand table answers to the brand’s access', () => {
  it('finds the brand tables and their policies', () => {
    expect(brandTables.size).toBeGreaterThan(90);
    expect(reaching.length).toBeGreaterThan(70);
    // Through brands: rows, rollups, the catalog's loop-made policies (00278), 00388's own.
    for (const table of [
      'prompt_results',
      'insights_brand_daily',
      'competitors',
      'catalog_products',
      'catalog_variants',
      'member_brands',
    ]) {
      expect(reaching, table).toContain(table);
    }
  });

  it('keeps RLS on for every brand table', () => {
    expect([...brandTables].filter((table) => !rls.has(table))).toEqual([]);
  });

  it('reaches the brand from every client policy, except the tables PR 3 fixes', () => {
    // A table here is new: read its brand through public.brands, or call
    // public.user_brand_ids() / public.can_access_brand() in its policies.
    // A table fixed by a later migration: take it off PR_3.
    expect(notReaching.sort()).toEqual(Object.keys(PR_3).sort());
  });

  it('lists the brand tables only the server reads and writes', () => {
    // A table here gained a client policy (it must reach the brand), or is a
    // new server-only one: say so in SERVER_ONLY.
    expect(serverOnly.sort()).toEqual([...SERVER_ONLY].sort());
  });

  it('says why each table on the PR 3 list skips the brand', () => {
    for (const [table, why] of Object.entries(PR_3)) expect(why.length, table).toBeGreaterThan(20);
  });
});
