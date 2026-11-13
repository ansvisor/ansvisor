# Notes for Claude

Read `CONTRIBUTING.md` first. These rules come from production incidents and apply to every change.

## Hard rules

1. **A `'use server'` file exports async functions only.**
   - Never export a `const`, a plain function, a class, an enum or a re-export from it. Types and interfaces are fine.
   - Breaking this still builds and passes tests. In production, though, the module throws on load and every Server Action bundled with it fails. This blanked every dashboard page's data on 12 Nov 2026 (#2347).
   - Put shared constants and helpers in a plain module.
   - `web/src/lib/use-server-exports.test.ts` checks this rule.
2. **A migration applies in seconds: schema and functions only.**
   - Never backfill a large table inside a migration in one statement.
   - Ship the backfill as a separate SQL function and script that are chunked (per brand or day range), idempotent and resumable.
   - Keep reads on the old path until a brand is marked ready.
   - Build big indexes after the backfill.
   - A one-statement backfill ran Postgres out of memory and caused a 4-minute outage on 12 Nov 2026 (#2352).

## Every change

- Every UI string goes in `web/messages/en.json`. Never hard-code copy.
- Every change people can see gets a Help article in `help/`, with at most 150 words per section. Regenerate with `cd web && yarn test -u src/lib/help`.
- One concern per branch and PR. Merge `main` into your branch; don't rebase or force-push a shared branch.
- Before pushing, run the typecheck, ESLint and Prettier on the changed files, and the tests you touched.
