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
 * Read from the migrations:
 *   * a brand table (one with a brand_id) passes when every top-level OR
 *     branch of each client policy condition ties the row's brand_id to
 *     brands (by the brand's id) or to the access rule;
 *   * a table without a brand_id passes when each branch reaches, by the row
 *     it names, a table that passes (a draft, a chat, a change that went
 *     live…), or calls content_draft_member(); otherwise it is on the list
 *     below of Account-level tables, with why.
 * Policies for the service role, policies that refuse everyone (`false`) and
 * restrictive ones (they only narrow) don't count.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const migrations = files.map((file) => readFileSync(new URL(file, dir), 'utf8'));

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

/**
 * Tables without a brand_id whose client policies don't reach a brand: the
 * Account's or the person's own, or (Chat's agents) decided elsewhere.
 */
const NOT_BRAND_DATA = {
  add_on_purchases: "The Account's purchases, for its admins (BRAND-ACCESS D1).",
  agent_token_usage: "A person's own monthly token use with the old Agent.",
  ai_bot_usage: "The Account's AI bot event meter against the plan (D1).",
  api_keys: "A person's own API keys; a key carries its owner's brand access (PR 10).",
  chat_agents:
    "An agent names its brands in its version's scope (jsonb, no brand_id); who sees which agent is Chat's rule (agent-rules canSeeAgent), PR 9.",
  chat_agent_triggers: "An agent's triggers, with the agent (chat_agents, PR 9).",
  chat_agent_versions: "An agent's versions, with the agent (chat_agents, PR 9).",
  chat_auto_choices: "A person's own Chat tool choices.",
  chat_settings: "The Account's Chat settings (D1).",
  chat_storage_usage: "The Account's Chat storage meter against the plan (D1).",
  chat_uploads:
    "A person's own uploads stay theirs; the others follow their chat (chat_conversations).",
  chat_user_prefs: "A person's own Chat preferences.",
  cloro_countries: 'The list of countries a prompt can track, the same for everyone.',
  content_authors: "The Account's authors for content (Settings › Authors).",
  content_rule_sets: "The Account's content rules.",
  integration_connections:
    "The Account's Google connection; per brand in BRAND-ACCESS PR 14 (brand_integrations).",
  invitations: "The Account's invitations, for its admins (00390).",
  organization_menu_roles: "The Account's menu access by role (00374).",
  organizations: 'The Account itself: its plan, billing and members (D1).',
  profiles: "A person's own profile.",
  site_audit_auto_runs:
    "The Account's monthly auto-audit runs: slots and audit ids; each audit's rows are its brand's.",
  site_audit_settings: "The Account's auto-audit switch.",
};

/** Roles that bypass RLS: a policy for them only is the server's. */
const SERVER_ROLES = new Set(['service_role', 'postgres', 'supabase_admin']);

/** Functions that apply brand access, which anon may not run. */
const ACCESS_CALL = /\b(?:public\.)?(?:can_access_brand|user_brand_ids|content_draft_member)\s*\(/i;

const BRAND_COLUMN = String.raw`(?:\w+\.)?brand_id`;

/**
 * A condition that ties the row's brand_id to brand access: the access rule,
 * the brand's own id from brands (whose policies apply inside), no brand at
 * all (nothing to hide), or false.
 */
const BRAND_BINDINGS = [
  new RegExp(String.raw`^${BRAND_COLUMN} in \( ?select (?:public\.)?user_brand_ids\(\) ?\)$`, 'i'),
  new RegExp(
    String.raw`^(?:select )?(?:public\.)?can_access_brand\( ?${BRAND_COLUMN} ?(?:, ?auth\.uid\(\) ?)?\)$`,
    'i',
  ),
  new RegExp(
    String.raw`^${BRAND_COLUMN} in \( ?select (?:distinct )?(\w+)\.id from \(* ?(?:public\.)?brands (?:as )?\1\b`,
    'i',
  ),
  new RegExp(
    String.raw`^exists \( ?select 1 from \(* ?(?:public\.)?brands (?:as )?(\w+)\b.*\b\1\.id = \(*${BRAND_COLUMN}\b`,
    'i',
  ),
  new RegExp(String.raw`^${BRAND_COLUMN} is null$`, 'i'),
  /^false$/i,
];

/** content_draft_member(draft): the draft's brand, by can_access_brand (00390). */
const DRAFT_MEMBER = /^(?:public\.)?content_draft_member\( ?\w+ ?\)$/i;

/** `<column> in (select <a>.id from <table> <a> …)`: the row of `table` the column names. */
const PARENT_ROW =
  /^\w+ in \( ?select (?:(\w+)\.)?id from \(* ?(?:public\.)?(\w+)(?: (?:as )?(\w+))?/i;

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

/** Comments out of a migration. */
const uncommented = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

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
  return expandLoops(uncommented(sql))
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim());
}

/**
 * The policies and the tables with RLS on, once every migration has run, as
 * pg_policies and pg_class would show them; and the policy statements that
 * name a table no earlier migration created (a fresh install, which runs the
 * migrations in order, would fail on them).
 */
function policyState() {
  const policies = new Map();
  const rls = new Set();
  const created = new Set();
  const early = [];
  const of = (table) => {
    if (!policies.has(table)) policies.set(table, new Map());
    return policies.get(table);
  };
  migrations.forEach((sql, i) => {
    for (const text of statements(sql)) {
      let m;
      const target = text.match(
        /^(?:create|alter|drop) policy (?:if exists )?(?:"[^"]+"|\S+) on ([\w."]+)/i,
      );
      if (target && !name(target[1]).includes('.') && !created.has(name(target[1]))) {
        early.push(`${files[i]}: ${name(target[1])}`);
      }
      if ((m = text.match(/^create table (?:if not exists )?([\w."]+)/i))) {
        created.add(name(m[1]));
      } else if ((m = text.match(/^create policy ("[^"]+"|\S+) on ([\w."]+) ?(.*)$/i))) {
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
          created.delete(name(table.trim()));
        }
      } else if (
        (m = text.match(/^alter table (?:if exists )?(?:only )?([\w."]+) rename to ([\w."]+)$/i))
      ) {
        const kept = policies.get(name(m[1]));
        policies.delete(name(m[1]));
        if (kept) policies.set(name(m[2]), kept);
        if (rls.delete(name(m[1]))) rls.add(name(m[2]));
        if (created.delete(name(m[1]))) created.add(name(m[2]));
      } else if (
        (m = text.match(
          /^alter table (?:if exists )?(?:only )?([\w."]+) (enable|disable) row level security$/i,
        ))
      ) {
        if (m[2].toLowerCase() === 'enable') rls.add(name(m[1]));
        else rls.delete(name(m[1]));
      }
    }
  });
  return { policies, rls, early };
}

/**
 * Policy statements a migration runs from inside a function or DO body that
 * expandLoops doesn't write out: this test can't read them.
 */
function hiddenPolicyStatements() {
  const hidden = [];
  migrations.forEach((sql, i) => {
    for (const [, , body] of expandLoops(uncommented(sql)).matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)) {
      if (/\b(?:create|alter)\s+policy\b/i.test(body)) hidden.push(files[i]);
    }
  });
  return hidden;
}

const { policies, rls, early } = policyState();
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

/** The index of the parenthesis that closes the one at `open`. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** A policy's `using (…)` and `with check (…)` conditions. */
function conditions(body) {
  const found = [];
  const start = /\b(using|with check) \(/gi;
  let m;
  while ((m = start.exec(body))) {
    const open = m.index + m[0].length - 1;
    const end = closing(body, open);
    found.push(body.slice(open + 1, end));
    start.lastIndex = end + 1;
  }
  return found;
}

/** Without the parentheses around the whole of it. */
function unwrap(expr) {
  let text = expr.trim();
  while (text.startsWith('(') && closing(text, 0) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** The parts of `expr` between its top-level `and`s or `or`s. */
function split(expr, word) {
  const parts = [];
  const at = new RegExp(`^${word}\\b`, 'i');
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
    else if (depth === 0 && expr[i] === ' ' && at.test(expr.slice(i + 1))) {
      parts.push(expr.slice(start, i));
      start = i + 1 + word.length;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Whether every row the condition lets in passes `binds`: each top-level OR
 * branch has a conjunct `binds` accepts, or a parenthesized conjunct that is
 * bound itself. String literals are left out first, so their words don't count.
 */
function bound(condition, binds) {
  const text = unwrap(condition.replace(/'(?:[^']|'')*'/g, "''"));
  const branches = split(text, 'or');
  if (branches.length > 1) return branches.every((branch) => bound(branch, binds));
  return split(text, 'and').some((part) => {
    const inner = unwrap(part);
    return binds(inner) || (inner !== part && bound(inner, binds));
  });
}

const bindsBrand = (part) => BRAND_BINDINGS.some((binding) => binding.test(part));

/** Every condition of every client policy of the table is bound by `binds`. */
function allBound(table, binds) {
  return clientPolicies(table).every((p) => {
    const found = conditions(p.body);
    return found.length > 0 && found.every((condition) => bound(condition, binds));
  });
}

const reaching = [];
const notReaching = [];
const serverOnly = [];
for (const table of brandTables) {
  if (clientPolicies(table).length === 0) serverOnly.push(table);
  else if (allBound(table, bindsBrand)) reaching.push(table);
  else notReaching.push(table);
}

/**
 * Tables without a brand_id, with client policies: each passes through the row
 * it names when that row's table passes, until no more do.
 */
const children = [...policies.keys()].filter(
  (table) => !brandTables.has(table) && table !== 'brands' && clientPolicies(table).length > 0,
);
const reached = new Set(reaching);
const bindsThroughParent = (part) => {
  if (bindsBrand(part) || DRAFT_MEMBER.test(part)) return true;
  const m = part.match(PARENT_ROW);
  return !!m && (!m[1] || m[1] === m[3]) && reached.has(m[2].toLowerCase());
};
for (let grew = true; grew; ) {
  grew = false;
  for (const table of children) {
    if (!reached.has(table) && allBound(table, bindsThroughParent)) {
      reached.add(table);
      grew = true;
    }
  }
}
const childrenReaching = children.filter((table) => reached.has(table));
const childrenNotReaching = children.filter((table) => !reached.has(table));

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
    expect(reaching.length).toBeGreaterThan(80);
    // Through brands: rows, rollups, the catalog's loop-made policies (00278), 00388's own;
    // through the access rule: 00390's and 00424's.
    for (const table of [
      'prompt_results',
      'insights_brand_daily',
      'competitors',
      'catalog_products',
      'catalog_variants',
      'member_brands',
      'prompt_usage_counters',
      'chat_conversations',
      'ship_events',
    ]) {
      expect(reaching, table).toContain(table);
    }
  });

  it('keeps RLS on for every brand table', () => {
    expect([...brandTables].filter((table) => !rls.has(table))).toEqual([]);
  });

  it('ties every top-level branch of every client policy to the row’s brand', () => {
    // A table here is new or changed: tie each `or` branch of its policies to
    // brand_id, with `brand_id in (select public.user_brand_ids())` or a
    // subquery that selects the brand's own id from public.brands. A branch
    // through the organization (`organization_id in (…)`) lets a
    // Selected-brands person read every brand's rows.
    expect(notReaching.sort()).toEqual([]);
  });

  it('lists the brand tables only the server reads and writes', () => {
    // A table here gained a client policy (it must reach the brand), or is a
    // new server-only one: say so in SERVER_ONLY.
    expect(serverOnly.sort()).toEqual([...SERVER_ONLY].sort());
  });
});

describe('every table without a brand_id', () => {
  it('reaches a brand through the row it belongs to', () => {
    for (const table of [
      'prompts',
      'prompt_notes',
      'action_tasks',
      'audit_signal_results',
      'content_draft_versions',
      'content_draft_inputs',
      'chat_messages',
      'chat_run_steps',
      'chat_asks',
      'chat_file_task_links',
      'impact_measurements',
      'impact_control_sets',
      'agent_messages',
    ]) {
      expect(childrenReaching, table).toContain(table);
    }
  });

  it('reaches a brand, or is on the Account-level list with why', () => {
    // A table here is new, or its policy changed: reach its brand through the
    // row it belongs to (`parent_id in (select p.id from public.<parent> p)`),
    // or, if it holds no brand's data, add it to NOT_BRAND_DATA with why.
    // A table on the list that now reaches a brand: take it off.
    expect(childrenNotReaching.sort()).toEqual(Object.keys(NOT_BRAND_DATA).sort());
  });

  it('says why each Account-level table holds no brand’s data', () => {
    for (const [table, why] of Object.entries(NOT_BRAND_DATA)) {
      expect(why.length, table).toBeGreaterThan(20);
    }
  });
});

describe('how the migrations write policies', () => {
  it('runs every policy statement where this test reads it', () => {
    // A policy made inside a function or DO block is invisible here: write
    // it as a statement, or as 00278's loop over a table list.
    expect(hiddenPolicyStatements()).toEqual([]);
  });

  it('gives policies that apply brand access to signed-in people (or the server) only', () => {
    // anon may not run the access functions (00388, 00215).
    const wrong = [];
    for (const [table, kept] of policies) {
      for (const [policy, p] of kept) {
        const roles = new Set(p.roles);
        roles.delete('authenticated');
        roles.delete('service_role');
        if (ACCESS_CALL.test(p.body) && roles.size > 0) wrong.push(`${table}: ${policy}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('makes no policy before its table, as a fresh install runs the migrations in order', () => {
    expect(early).toEqual([]);
  });
});
