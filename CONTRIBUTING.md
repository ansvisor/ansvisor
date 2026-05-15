# Contributing to Ansvisor

Thank you for your interest in contributing to Ansvisor! This guide will help you get started.

## Ways to Contribute

- **Bug reports** — found something broken? Open an issue.
- **Feature requests** — have an idea? Start a discussion or open an issue.
- **Code contributions** — fix a bug or implement a feature via pull request.
- **Documentation** — improve guides, fix typos, add examples.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- A [Supabase](https://supabase.com/) project (URL + anon key)
- At least one AI provider API key (OpenAI, Google Gemini, Anthropic, Perplexity, or Grok)
- [Docker](https://www.docker.com/) + Docker Compose (optional, for containerized setup)

## Project Structure

```
ansvisor/
├── web/                 # Next.js 16 frontend (TypeScript)
├── server/              # Express backend (Node.js ESM)
├── supabase/            # Database migrations and config
├── scripts/             # Version management tooling
├── docker-compose.yml   # Containerized deployment
├── CHANGELOG.md
└── LICENSE
```

Both `web/` and `server/` are independent packages with their own `package.json` and `Dockerfile`. They share a unified version number managed from the root.

## Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/aeohub/ansvisor.git
cd ansvisor
```

### 2. Configure environment variables

```bash
cp web/.env.example web/.env.local
cp server/.env.example server/.env
```

Fill in at minimum:

- **Supabase** URL and anon key (both `web/.env.local` and `server/.env`)
- **At least one AI API key** in `server/.env` (e.g. `OPENAI_API_KEY`)

### 3. Set up the database

Run the migration SQL to create all tables, indexes, RLS policies, and triggers in your Supabase project:

**Option A — Supabase SQL Editor (easiest):**

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. For each file in `supabase/migrations/` (in alphabetical order — `00001_…` first, then `00002_…`, etc.), paste its contents and click **Run**

**Option B — Supabase CLI:**

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

### 4. Install dependencies

The web app uses **yarn**, the server uses **npm**:

```bash
cd web && yarn install
cd ../server && npm install
```

### 5. Start dev servers

In separate terminals:

```bash
# Terminal 1 — frontend (http://localhost:3000)
cd web && yarn dev

# Terminal 2 — backend (http://localhost:80)
cd server && npm run dev
```

### Docker alternative

If you prefer Docker, configure your `.env` files first, then:

```bash
docker compose up --build
```

## Branch Naming

We follow [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) with a single `main` branch. Create short-lived branches from `main` using these prefixes:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New feature | `feature/competitor-export` |
| `fix/` | Bug fix | `fix/tracking-timeout` |
| `chore/` | Maintenance | `chore/update-deps` |
| `docs/` | Documentation | `docs/setup-guide` |

## Making Changes

1. Create a branch from `main`:

   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes and commit (see commit conventions below).

3. Verify versions are in sync:

   ```bash
   npm run version:check
   ```

4. Push and open a pull request against `main`.

5. In your PR description, include:
   - **What** changed and **why**
   - **How to test** the change
   - Screenshots if there are UI changes

6. Wait for review, address feedback, and your PR will be merged.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, dependency updates |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |

**Examples:**

```
feat: add competitor export endpoint
fix: resolve tracking timeout on large datasets
chore: update AI SDK to v6.1
docs: add self-hosting guide
```

Scope is optional but helpful for monorepo clarity:

```
feat(server): add rate limiting to tracking API
fix(web): correct chart rendering on mobile
```

## Code Style

### Web (`web/`)

- TypeScript with strict mode enabled
- ESLint with `eslint-config-next` (core-web-vitals + typescript)
- Run `yarn lint` before submitting

### Server (`server/`)

- Node.js with ES modules (`"type": "module"`)
- Zod for runtime validation
- Follow existing patterns in `src/`

### General

- Follow the conventions already present in the codebase
- Keep changes focused — one concern per PR

## Versioning

All three `package.json` files (root, `web/`, `server/`) share the same version. Use the provided scripts to manage versions:

```bash
# Check that all versions match
npm run version:check

# Bump version (updates all three package.json files)
npm run version:bump -- patch   # 0.1.0 → 0.1.1
npm run version:bump -- minor   # 0.1.0 → 0.2.0
npm run version:bump -- major   # 0.1.0 → 1.0.0
```

Do not edit version numbers in `package.json` files manually.

## Reporting Issues

When opening an issue, please include:

- **Bug reports:** Steps to reproduce, expected vs. actual behavior, Node.js version, browser (if applicable)
- **Feature requests:** Use case description and why it would be useful

## License

By contributing to Ansvisor, you agree that your contributions will be licensed under the [MIT License](LICENSE).
