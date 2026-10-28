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
 * change (a signed upload address too), an auth change, or an RPC whose
 * database function isn't declared STABLE or IMMUTABLE (supabase/schema.sql).
 * A query or bucket kept in a name first (`const images = ….storage.from(…)`)
 * is followed to it.
 *
 * The check comes first: it is the first thing a gated action awaits. And a
 * setup action (assertWritable({ onboarding: true })) never runs one in its
 * file that checks without it — that check would refuse the organization
 * setup lets through.
 */

const ACTIONS_DIR = join(__dirname, 'actions');
const API_DIR = join(__dirname, '../app/api');
const SCHEMA = join(__dirname, '../../../supabase/schema.sql');

/**
 * Server actions that write and stay open while read-only: file:function →
 * why. One that writes through the API (a fetch that posts, puts, patches or
 * deletes) is named here when the API keeps that route open too.
 */
const OPEN_ACTIONS: Record<string, string> = {
  'organization.ts:updateAccountName': "the person's own profile",
  'team.ts:acceptInvitation': "the invited person's own account joins",
  'team.ts:revokeInvitation': 'takes back access, never gives it',
  'team.ts:removeMember': 'takes back access, never gives it',
  'getting-started.ts:markGettingStartedPageOpened': 'a trace of reading a page',
  'content-images.ts:prepareImageUpload':
    'checks the plan itself (isSubscriptionActive), to answer "plan" instead of throwing',
  'brand.ts:deleteBrand':
    'deleting a brand only removes what the person gave us (Ansvisor, 2026-10-27)',
  'menu-access.ts:setMyWorkAreas':
    'the person\'s own profile; it answers "What do you work on?", which /dashboard/welcome waits on',
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
  'stripe/promo-code:POST': 'billing: checking a promo code',
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
const STORAGE_WRITES = new Set([
  'upload',
  'update',
  'remove',
  'move',
  'copy',
  'createSignedUploadUrl',
]);

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
  /** Its fetches that change something through the API: `DELETE`, `POST`… */
  apiWrites: string[];
  gates: string[];
  /** It calls assertWritable() without `onboarding: true`. */
  strictGate: boolean;
  /** It calls assertWritable({ onboarding: true }). */
  onboardingGate: boolean;
  /** What it awaits first, outside the functions inside it: the callee's name, else the text. */
  firstAwait: string | null;
  callees: string[];
}

/** What a file names with `const`/`let`, by name: `images` → `supabase.storage.from(…)`. */
type Bindings = Map<string, ts.Expression>;

function readBindings(source: ts.SourceFile): Bindings {
  const bound: Bindings = new Map();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      bound.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return bound;
}

/**
 * The chain a call hangs off: `supabase.from('x').select()` → true for
 * `.from`. A name is followed to what it was given, and a one-line arrow
 * to what it returns: `const uploads = () => admin.from('x')`.
 */
function chainCalls(node: ts.Expression, name: string, bound: Bindings): boolean {
  let current: ts.Expression = node;
  const followed = new Set<string>();
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
    } else if (ts.isArrowFunction(current) && !ts.isBlock(current.body)) {
      current = current.body;
    } else if (ts.isIdentifier(current) && bound.has(current.text) && !followed.has(current.text)) {
      followed.add(current.text);
      current = bound.get(current.text)!;
    } else {
      return false;
    }
  }
}

/** The first await in a function's own body, in source order: not in the functions inside it. */
function firstAwaitIn(root: ts.Node): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (found !== null) return;
    if (n !== root && ts.isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n)) {
      const awaited = n.expression;
      found =
        ts.isCallExpression(awaited) && ts.isIdentifier(awaited.expression)
          ? awaited.expression.text
          : awaited.getText().slice(0, 60);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
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
  const bound = readBindings(source);
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
    const fact: FunctionFacts = {
      exported,
      writes: [],
      apiWrites: [],
      gates: [],
      strictGate: false,
      onboardingGate: false,
      firstAwait: firstAwaitIn(node),
      callees: [],
    };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text;
          const target = callee.expression;
          if (chainCalls(target, 'storage', bound) && STORAGE_WRITES.has(method)) {
            fact.writes.push(`storage.${method}`);
          } else if (DB_WRITES.has(method) && chainCalls(target, 'from', bound)) {
            fact.writes.push(method);
          } else if (method === 'rpc') {
            const arg = n.arguments[0];
            const fn = arg && ts.isStringLiteralLike(arg) ? arg.text : '?';
            if (!readRpcs.has(fn)) fact.writes.push(`rpc ${fn}`);
          } else if (
            method === 'updateUser' ||
            (chainCalls(target, 'admin', bound) &&
              chainCalls(target, 'auth', bound) &&
              !['listUsers', 'getUserById'].includes(method))
          ) {
            fact.writes.push(`auth.${method}`);
          }
        } else if (ts.isIdentifier(callee)) {
          const called = callee.text;
          const opensMcpWrites = n.arguments.some((a) => /gateWrites:\s*false/.test(a.getText()));
          if (gateNames.has(called) && !opensMcpWrites) fact.gates.push(called);
          if (called === 'assertWritable') {
            const onboarding = n.arguments.some((a) => /onboarding:\s*true/.test(a.getText()));
            if (onboarding) fact.onboardingGate = true;
            else fact.strictGate = true;
          }
          if (bodies.has(called)) fact.callees.push(called);
          if (
            called === 'fetch' &&
            n.arguments[1] &&
            ts.isObjectLiteralExpression(n.arguments[1])
          ) {
            for (const prop of n.arguments[1].properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                prop.name.getText() === 'method' &&
                ts.isStringLiteralLike(prop.initializer) &&
                WRITE_METHODS.has(prop.initializer.text)
              ) {
                fact.apiWrites.push(prop.initializer.text);
              }
            }
          }
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
  const apiWrites = new Set<string>();
  const gates = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const fact = facts.get(current)!;
    fact.writes.forEach((w) => writes.add(w));
    fact.apiWrites.forEach((w) => apiWrites.add(w));
    fact.gates.forEach((g) => gates.add(g));
    fact.callees.forEach(walk);
  };
  walk(name);
  return { writes: [...writes], apiWrites: [...apiWrites], gated: gates.size > 0 };
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

const readRpcs = readOnlyFunctions();

/** The server action files ('use server' in lib/actions), each with its functions. */
const actionFiles = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .filter((f) => /^['"]use server['"]/m.test(readFileSync(join(ACTIONS_DIR, f), 'utf8')))
  .map((file) => ({
    file,
    facts: readFunctions(join(ACTIONS_DIR, file), readRpcs, new Set(['assertWritable'])),
  }));

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
    const apiWriters = new Set<string>();
    const gatedOpen: string[] = [];
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        if (!fact.exported) continue;
        const { writes, apiWrites, gated } = reach(facts, name);
        const key = `${file}:${name}`;
        if (apiWrites.length) apiWriters.add(key);
        if (key in OPEN_ACTIONS && gated) gatedOpen.push(key);
        // A write through the API is the API's to refuse (requireActiveSubscription).
        if (!writes.length) continue;
        writers.add(key);
        if (!(key in OPEN_ACTIONS) && !gated) ungated.push(`${key} (${writes.join(', ')})`);
      }
    }
    expect(ungated).toEqual([]);
    // The open list stays true: each one writes, here or through the API, and doesn't check after all.
    expect(
      Object.keys(OPEN_ACTIONS).filter((key) => !writers.has(key) && !apiWriters.has(key)),
    ).toEqual([]);
    expect(gatedOpen).toEqual([]);
    // Sanity: the scan finds the writes it is meant to.
    expect(writers.size).toBeGreaterThan(90);
  });

  it('has every gated action check the plan before anything else it awaits', () => {
    const late: string[] = [];
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        const key = `${file}:${name}`;
        if (!fact.exported || key in OPEN_ACTIONS || !reach(facts, name).writes.length) continue;
        if (fact.firstAwait !== 'assertWritable') {
          late.push(`${key} (awaits ${fact.firstAwait ?? 'nothing'} first)`);
        }
      }
    }
    expect(late).toEqual([]);
  });

  it("has no setup action run a function in its file whose check refuses setup's organization", () => {
    // A setup action is open to an organization that never subscribed; a
    // plain assertWritable() it runs on the way would refuse that one.
    const refused: string[] = [];
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        if (!fact.onboardingGate) continue;
        const seen = new Set([name]);
        const walk = (callee: string) => {
          if (seen.has(callee)) return;
          seen.add(callee);
          const called = facts.get(callee)!;
          if (called.strictGate) refused.push(`${file}:${name} → ${callee}`);
          called.callees.forEach(walk);
        };
        fact.callees.forEach(walk);
      }
    }
    expect(refused).toEqual([]);
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
