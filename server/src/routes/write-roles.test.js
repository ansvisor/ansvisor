import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every write route a signed-in person can call checks their role, or says
 * here why it doesn't (2026-11-03). Role model A: daily work is every
 * member's; settings, connections, deletes and work that spends the plan's AI
 * or paid data are for admins and managers (see CONTRIBUTING.md, "Roles").
 *
 * A new POST, PUT, PATCH or DELETE route under routes/index.js fails here
 * until it calls a role check, or is added to OPEN with its reason. A role
 * check is assertRole() or allowRole() from lib/access.js, a read of the
 * caller's role (a list such as MANAGER_ROLES, or profile.role), or a
 * function of the route's file, or of the route file it imports it from,
 * that does one.
 *
 * The webhooks, callbacks, the tracking beacon and the internal endpoints are
 * mounted in server.js, outside the person's /api, and answer to a secret or
 * a signature instead: they aren't read here.
 */

/** Open to every member of the brand's workspace, each with its reason. */
const OPEN = {
  // Action Center: working on actions and tasks is daily work (actions RLS).
  'POST /api/action-center/signals/:id/rescore': 'Scores a signal again, no model.',
  'POST /api/action-center/tasks/:id/check': 'Check now on a task.',
  'POST /api/action-center/pages': 'Send to Action Center from AI Traffic.',
  'POST /api/action-center/audits': 'Send to Action Center from Site Audit.',
  'POST /api/action-center/content-drafts': 'Send to Action Center from a draft.',
  'POST /api/action-center/products': 'Send to Action Center from Product Visibility.',
  'POST /api/content/:id/action': 'Send an opportunity to the Action Center.',
  'POST /api/mentions/action': 'Send mentions to the Action Center.',
  'POST /api/topics/:id/gap-action': "Send a topic's biggest gap to the Action Center.",
  'POST /api/topics/:id/opportunity-action': "Send a topic's opportunity to the Action Center.",
  // Site Audit: running an audit stays open (2026-10-29).
  'POST /api/audits': 'Runs a Site Audit.',
  'POST /api/audits/bulk': 'Re-audits the pages picked.',
  // Content Editor: writing stays open (2026-10-29); each AI step is metered.
  'POST /api/content-drafts/:draftId/brief': "Writes the draft's brief.",
  'POST /api/content-drafts/:draftId/shopping-path': "Reads the draft's shopping path.",
  'POST /api/content-drafts/:draftId/suggestions': 'Content Agent suggestions.',
  'POST /api/content-drafts/:draftId/handoff': 'Hands the draft to the Content Agent.',
  'POST /api/content-drafts/:draftId/write': 'The Content Agent writes the draft.',
  'POST /api/content-drafts/:draftId/rewrite': 'Rewrites a part of the draft.',
  'POST /api/content-drafts/:draftId/audit-estimate': "Estimates the draft's audit score.",
  'POST /api/content-drafts/:draftId/stop': 'Stops a write.',
  'POST /api/content-drafts/webflow-status': 'Reads where a page stands in Webflow.',
  'POST /api/content-drafts/wordpress-status': 'Reads where a page stands in WordPress.',
  'POST /api/content-drafts/framer-status': 'Reads where a page stands in Framer.',
  'POST /api/content-drafts/wix-status': 'Reads where a page stands in Wix.',
  'POST /api/content-pages/import': 'Imports a page into the editor.',
  'POST /api/content-pages/links': "Reads the draft's links.",
  'POST /api/content-pages/source-classes': "Classifies the draft's sources.",
  'POST /api/content-pages/claims': "Reads the draft's claims for Trust.",
  'POST /api/content-pages/page-read': 'Reads a page for the editor.',
  // Publishing: whose it is, is decided in #1894.
  'POST /api/content-drafts/:draftId/publish': 'Publishing, decided in #1894.',
  // Reading, with no change to the workspace.
  'POST /api/brands/:id/tracking-snippet/check': 'Checks whether the snippet is installed.',
  'POST /api/prompts/fanout-intents': 'The Fan-out tab calls it on its own.',
  'POST /api/reports/summary': "A report's AI summary stays open (2026-11-03).",
  'POST /api/demo': 'Opens the demo brand, for any member.',
};

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

/** The route files under the person's /api, with where each is mounted. */
function mountedFiles() {
  const index = read('./index.js');
  const files = new Map(
    [...index.matchAll(/^import (\w+) from '\.\/([\w-]+\.js)';$/gm)].map(([, name, file]) => [
      name,
      file,
    ]),
  );
  return [...index.matchAll(/router\.use\('([^']+)', (\w+)\)/g)].map(([, mount, name]) => ({
    mount: `/api${mount}`,
    file: files.get(name),
  }));
}

const ROLE_READ = /\b(?:assertRole|allowRole)\(|\b[A-Z_]+_ROLES\b|\.role\b/;

/** The functions of a file that check the role, themselves or through another of its own. */
const checkingFunctions = (() => {
  const cache = new Map();
  const of = (file) => {
    if (cache.has(file)) return cache.get(file);
    cache.set(file, new Set());
    const src = read(`./${file}`);
    const bodies = new Map();
    for (const m of src.matchAll(/(?:^|\n)(?:export )?(?:async )?function (\w+)\s*\(/g)) {
      const end = src.indexOf('\n}\n', m.index + 1);
      bodies.set(m[1], src.slice(m.index, end > 0 ? end : undefined));
    }
    const checking = new Set();
    // A role check imported from another route file (cms.js's assertWriter).
    for (const [, names, from] of src.matchAll(/import \{([^}]+)\} from '\.\/([\w-]+\.js)'/g)) {
      const theirs = of(from);
      for (const name of names.split(',').map((n) => n.trim())) {
        if (theirs.has(name)) checking.add(name);
      }
    }
    const calls = (body) => [...checking].some((name) => new RegExp(`\\b${name}\\(`).test(body));
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, body] of bodies) {
        if (!checking.has(name) && (ROLE_READ.test(body) || calls(body))) {
          checking.add(name);
          grew = true;
        }
      }
    }
    cache.set(file, checking);
    return checking;
  };
  return of;
})();

/** Each write route of a file: its method, path and whether its handler checks the role. */
function writeRoutes(file, mount) {
  const src = read(`./${file}`);
  const checking = checkingFunctions(file);
  const calls = [...src.matchAll(/router\.(get|post|put|patch|delete|use)\(\s*'([^']*)'/g)];
  return calls.flatMap((m, i) => {
    if (m[1] === 'get' || m[1] === 'use') return [];
    // The handler ends at its closing line; a helper below it is not its call.
    let handler = src.slice(m.index, calls[i + 1]?.index);
    const end = handler.indexOf('\n});\n');
    if (end > 0) handler = handler.slice(0, end);
    const checks =
      ROLE_READ.test(handler) ||
      [...checking].some((name) => new RegExp(`\\b${name}\\(`).test(handler));
    const path = m[2] === '/' ? '' : m[2];
    return [{ route: `${m[1].toUpperCase()} ${mount}${path}`, file, checks }];
  });
}

const routes = mountedFiles().flatMap(({ mount, file }) => writeRoutes(file, mount));

describe("the person's write routes", () => {
  it('are found', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.find((r) => r.route === 'DELETE /api/audits/:id')).toMatchObject({
      checks: true,
    });
  });

  it('each check the role, or are open for a reason written here', () => {
    const unchecked = routes.filter((r) => !r.checks && !(r.route in OPEN));
    expect(unchecked.map((r) => `${r.route} (${r.file})`)).toEqual([]);
  });

  it('list no route here that checks the role or is gone', () => {
    const unchecked = new Set(routes.filter((r) => !r.checks).map((r) => r.route));
    expect(Object.keys(OPEN).filter((route) => !unchecked.has(route))).toEqual([]);
  });
});
