# Releasing

The web app ships from the `production` branch (Vercel), the API server runs
in Docker on one VM, and migrations go to the hosted Supabase database. A
release puts all three on the same `main` commit, in the order the app needs.

## Running a release

1. Open **Actions › Release › Run workflow**. Leave the commit empty for
   `main`'s latest, or paste a commit on `main` whose CI passed.
2. Approve the run when GitHub asks (the `release` environment's reviewers).
3. Follow the run. Its summary lists the migrations applied and the result.

The workflow (`.github/workflows/release.yml`):

1. **Checks** the commit is on `main`, its CI passed, and `production` can
   move forward to it.
2. **Checks the migrations**: lists the ones the database hasn't recorded
   (from 00371 up, matched on the 5-digit prefix).
3. **Builds the server image** on the VM. The running server keeps running.
4. **Applies the migrations** in number order, then checks none is missing.
5. **Starts the new server** and checks it stays up and answers. If it
   doesn't, the VM goes back to the server that ran before and the release
   stops.
6. **Ships the web app** by moving `production`, then waits for Vercel's
   deployment and checks the app answers.

If a step fails, the steps after it don't run: nothing ships past a failed
migration or an unhealthy server.

## Migrations that need a person

A migration that must not run unattended (a large backfill, an index on a big
table) carries this line:

```sql
-- release: manual
```

The release stops before changing anything and names it. Apply it by hand,
then run the release again; it skips what the database already has.

Keep migrations quick (schema and functions only) and ship backfills as
chunked scripts, as CLAUDE.md says.

## Rolling back

- **Server:** the release rolls back on its own when the new server isn't
  healthy. Later, revert on `main` and release again (`production` only moves
  forward, so an older commit can't be released).
- **Web:** promote the previous deployment in Vercel, or revert on `main`.
- **Migrations** are not rolled back: write a new migration.

## Setup (once)

- `release` environment: required reviewers, `main` only.
  - secret `SUPABASE_ACCESS_TOKEN`: a Supabase access token with Database
    read and write.
  - vars `AWS_RELEASE_ROLE_ARN`, `AWS_REGION`, `EC2_INSTANCE_ID`,
    `SUPABASE_PROJECT_REF`, `APP_URL`.
- AWS: GitHub's OIDC provider, a role trusted only by this repository's
  `release` environment that may only send SSM shell commands to the VM, and
  an instance profile on the VM with `AmazonSSMManagedInstanceCore`.
