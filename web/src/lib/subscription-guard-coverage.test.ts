// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every write the web app makes straight to Supabase checks the plan first,
 * read from the code: each server action in lib/actions that writes —
 * itself or through a helper in its file — calls assertWritable, and each
 * POST, PUT, PATCH or DELETE route under app/api checks the plan, unless it
 * is named below with why it stays open while the workspace is read-only.
 * A new write is gated, or named here, before it ships.
 *
 * A write is .insert/.update/.upsert/.delete on a .from() query, a storage
 * change, an auth change, or an RPC whose database function isn't declared
 * STABLE or IMMUTABLE (supabase/schema.sql).
 */

const ACTIONS_DIR = join(__dirname, 'actions');
const API_DIR = join(__dirname, '../app/api');
const SCHEMA = join(__dirname, '../../../supabase/schema.sql');

/** Server actions that write and stay open while read-only: file:function → why. */
const OPEN_ACTIONS: Record<string, string> = {
  'organization.ts:updateAccountName': "the person's own profile",
  'team.ts:acceptInvitation': "the invited person's own account joins",
  'team.ts:revokeInvitation': 'takes back access, never gives it',
  'team.ts:removeMember': 'takes back access, never gives it',
  'getting-started.ts:markGettingStartedPageOpened': 'a trace of reading a page',
};

/** Write routes that stay open while read-only: path:METHOD → why. */
const OPEN_ROUTES: Record<string, string> = {
  'aeo/[...path]:POST': 'a proxy to the API, which answers 402 itself',
  'aeo/[...path]:PUT': 'a proxy to the API, which answers 402 itself',
  'aeo/[...path]:PATCH': 'a proxy to the API, which answers 402 itself',
  'aeo/[...path]:DELETE': 'a proxy to the API, which answers 402 itself',
  'agent/conversations/[id]:DELETE': 'deleting a conversation starts no cost',
  'keys:POST': 'a key costs nothing and only reads while read-only (2026-10-14 decision)',
  'keys/[id]:DELETE': 'revoking a key takes back access',
  'mcp:POST': 'its tools are gated one by one (gateWriteTools)',
  'mcp:DELETE': 'ends an MCP session',
  'settings/ai-providers:DELETE': 'removing a key takes back access',
  'stripe/checkout:POST': 'billing: choosing a plan',
  'stripe/portal:POST': 'billing: the payment method',
  'stripe/subscription:PATCH': 'billing: changing the plan',
  'stripe/subscription:DELETE': 'billing: canceling the plan',
  'stripe/webhook:POST': "Stripe's own calls",
  'traffic/read:POST': 'reads only',
};

/** What checks a route's plan before it writes. */
const ROUTE_GATES = new Set([
  'writeRefusal',
  'assertWritable',
  'subscriptionActiveFor',
  'assertSubscriptionActive',
  'authenticateMcpRequest',
]);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DB_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
const STORAGE_WRITES = new Set(['upload', 'update', 'remove', 'move', 'copy']);

/** The database functions that only read: their last definition is STABLE or IMMUTABLE. */
function readOnlyFunctions(): Set<string> {
  const sql = readFileSync(SCHEMA, 'utf8');
  const volatility = new Map<string, boolean>();
  const create = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
  for (const match of sql.matchAll(create)) {
    const rest = sql.slice(match.index);
    const open = /\bas\s+(\$\w*\$)/i.exec(rest);
    if (!open) continue;
    const close = rest.indexOf(open[1], open.index + open[0].length);
    if (close < 0) continue;
    const end = rest.indexOf(';', close + open[1].length);
    const declared = rest.slice(0, open.index) + rest.slice(close, end < 0 ? undefined : end);
    volatility.set(match[1], /\b(stable|immutable)\b/i.test(declared));
  }
  return new Set([...volatility].filter(([, reads]) => reads).map(([name]) => name));
}

interface FunctionFacts {
  exported: boolean;
  writes: string[];
  gates: string[];
  callees: string[];
}

/** The chain a call hangs off: `supabase.from('x').select()` → true for `.from`. */
function chainCalls(node: ts.Expression, name: string): boolean {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === name) return true;
      current = callee;
    } else if (ts.isPropertyAccessExpression(current)) {
      if (current.name.text === name) return true;
      current = current.expression;
    } else if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else {
      return false;
    }
  }
}

/** The top-level functions of a file: what each writes, which gates it calls, and its callees there. */
function readFunctions(
  file: string,
  readRpcs: Set<string>,
  gateNames: Set<string>,
): Map<string, FunctionFacts> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const bodies = new Map<string, { node: ts.Node; exported: boolean }>();
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      bodies.set(statement.name.text, { node: statement.body, exported: isExported(statement) });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          bodies.set(declaration.name.getText(source), {
            node: init,
            exported: isExported(statement),
          });
        }
      }
    }
  }

  const facts = new Map<string, FunctionFacts>();
  for (const [name, { node, exported }] of bodies) {
    const fact: FunctionFacts = { exported, writes: [], gates: [], callees: [] };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text;
          const target = callee.expression;
          if (chainCalls(target, 'storage') && STORAGE_WRITES.has(method)) {
            fact.writes.push(`storage.${method}`);
          } else if (DB_WRITES.has(method) && chainCalls(target, 'from')) {
            fact.writes.push(method);
          } else if (method === 'rpc') {
            const arg = n.arguments[0];
            const fn = arg && ts.isStringLiteralLike(arg) ? arg.text : '?';
            if (!readRpcs.has(fn)) fact.writes.push(`rpc ${fn}`);
          } else if (
            method === 'updateUser' ||
            (chainCalls(target, 'admin') &&
              chainCalls(target, 'auth') &&
              !['listUsers', 'getUserById'].includes(method))
          ) {
            fact.writes.push(`auth.${method}`);
          }
        } else if (ts.isIdentifier(callee)) {
          const called = callee.text;
          const opensMcpWrites = n.arguments.some((a) => /gateWrites:\s*false/.test(a.getText()));
          if (gateNames.has(called) && !opensMcpWrites) fact.gates.push(called);
          if (bodies.has(called)) fact.callees.push(called);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    facts.set(name, fact);
  }
  return facts;
}

/** What a function writes and which gates it calls, through the helpers in its file. */
function reach(facts: Map<string, FunctionFacts>, name: string) {
  const writes = new Set<string>();
  const gates = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const fact = facts.get(current)!;
    fact.writes.forEach((w) => writes.add(w));
    fact.gates.forEach((g) => gates.add(g));
    fact.callees.forEach(walk);
  };
  walk(name);
  return { writes: [...writes], gated: gates.size > 0 };
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

const readRpcs = readOnlyFunctions();

describe('read-only coverage', () => {
  it('reads which database functions only read', () => {
    // A sample each way, so a schema the parser can't read fails here.
    expect(readRpcs.has('mentions_list')).toBe(true);
    expect(readRpcs.has('insights_aggregates_daily')).toBe(true);
    expect(readRpcs.has('import_prompts')).toBe(false);
    expect(readRpcs.has('content_draft_snapshot')).toBe(false);
  });

  it('has every server action that writes call assertWritable, or name why it stays open', () => {
    const ungated: string[] = [];
    const writers = new Set<string>();
    const gatedOpen: string[] = [];
    const files = readdirSync(ACTIONS_DIR).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    for (const file of files) {
      const path = join(ACTIONS_DIR, file);
      if (!/^['"]use server['"]/m.test(readFileSync(path, 'utf8'))) continue;
      const facts = readFunctions(path, readRpcs, new Set(['assertWritable']));
      for (const [name, fact] of facts) {
        if (!fact.exported) continue;
        const { writes, gated } = reach(facts, name);
        if (!writes.length) continue;
        const key = `${file}:${name}`;
        writers.add(key);
        if (key in OPEN_ACTIONS) {
          if (gated) gatedOpen.push(key);
        } else if (!gated) {
          ungated.push(`${key} (${writes.join(', ')})`);
        }
      }
    }
    expect(ungated).toEqual([]);
    // The open list stays true: each one writes, and doesn't check after all.
    expect(Object.keys(OPEN_ACTIONS).filter((key) => !writers.has(key))).toEqual([]);
    expect(gatedOpen).toEqual([]);
    // Sanity: the scan finds the writes it is meant to.
    expect(writers.size).toBeGreaterThan(90);
  });

  it('has every write route check the plan, or name why it stays open', () => {
    const ungated: string[] = [];
    const handlers = new Set<string>();
    for (const path of routeFiles(API_DIR)) {
      const route = relative(API_DIR, path).replace(/\/route\.ts$/, '');
      const facts = readFunctions(path, readRpcs, ROUTE_GATES);
      for (const [name, fact] of facts) {
        if (!fact.exported || !WRITE_METHODS.has(name)) continue;
        const key = `${route}:${name}`;
        handlers.add(key);
        if (!(key in OPEN_ROUTES) && !reach(facts, name).gated) ungated.push(key);
      }
    }
    expect(ungated).toEqual([]);
    expect(Object.keys(OPEN_ROUTES).filter((key) => !handlers.has(key))).toEqual([]);
  });
});
