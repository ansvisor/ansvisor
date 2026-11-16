#!/usr/bin/env node
/**
 * The Release workflow's migration step (.github/workflows/release.yml).
 *
 * Lists the numbered migrations in supabase/migrations that the hosted
 * database hasn't recorded yet, matched on the 5-digit prefix (so `_partN`
 * splits and renamed files count as one), and applies them in number order
 * through the Supabase Management API, which records each one.
 *
 *   node scripts/release/migrations.mjs --check   list what's missing, apply nothing
 *   node scripts/release/migrations.mjs --apply   apply what's missing, then check again
 *
 * Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.
 *
 * Migrations up to 00370 are recorded under unnumbered names, so only 00371
 * and up are compared. A migration that must not be applied unattended (a
 * large backfill, for one) carries the line `-- release: manual`: the check
 * fails on it, and it is applied by hand before the release runs again.
 */
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const FIRST_COMPARED = 371;
const MANUAL = /^--\s*release:\s*manual\b/im;
// The Management API records each migration under a per-second version: two
// in the same second collide, so the next waits out the second.
const PAUSE_MS = 1_200;

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--apply') {
  console.error('usage: migrations.mjs --check | --apply');
  process.exit(2);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');
  process.exit(2);
}
const API = `https://api.supabase.com/v1/projects/${ref}/database`;

async function api(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** The 5-digit prefixes the hosted database has recorded. */
async function applied() {
  const rows = await api('query', {
    query: `select distinct substring(name from 1 for 5) as p
              from supabase_migrations.schema_migrations where name ~ '^[0-9]{5}'
            union
            select distinct substring(version from 1 for 5)
              from supabase_migrations.schema_migrations where version ~ '^[0-9]{5}_'`,
  });
  return new Set(rows.map((r) => r.p));
}

/** The repo's numbered migrations from 00371 up, grouped by prefix, in order. */
function inRepo() {
  const byPrefix = new Map();
  for (const file of readdirSync(DIR).filter((f) => /^\d{5}_.*\.sql$/.test(f)).sort()) {
    const prefix = file.slice(0, 5);
    if (Number(prefix) < FIRST_COMPARED) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(file);
  }
  return byPrefix;
}

function summary(lines) {
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

async function missing() {
  const done = await applied();
  return [...inRepo()].filter(([prefix]) => !done.has(prefix));
}

const todo = await missing();
if (todo.length === 0) {
  summary(['### Migrations', '', 'Nothing to apply: the database has every migration in this commit.']);
  process.exit(0);
}

const files = todo.flatMap(([, list]) => list);
const manual = files.filter((f) => MANUAL.test(readFileSync(join(DIR, f), 'utf8')));
summary(['### Migrations', '', ...files.map((f) => `- ${f}${manual.includes(f) ? ' (manual)' : ''}`), '']);

if (manual.length) {
  summary([
    `**Stopped:** ${manual.join(', ')} ${manual.length === 1 ? 'is' : 'are'} marked \`-- release: manual\`.`,
    'Apply by hand, then run the release again.',
  ]);
  process.exit(1);
}
if (mode === '--check') process.exit(0);

for (const [i, file] of files.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  const started = Date.now();
  await api('migrations', {
    name: file.replace(/\.sql$/, ''),
    query: readFileSync(join(DIR, file), 'utf8'),
  });
  console.log(`applied ${file} in ${Date.now() - started} ms`);
}

const left = await missing();
if (left.length) {
  summary([`**Still missing after apply:** ${left.map(([p]) => p).join(', ')}`]);
  process.exit(1);
}
summary([`Applied ${files.length} migration(s); none missing now.`]);
