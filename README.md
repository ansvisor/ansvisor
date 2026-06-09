<div align="center">

[![Ansvisor Banner](https://cdn.prod.website-files.com/69e606308fb6f96fb911b251/69f0a8f250aa69dd7f6d9a30_s12.svg)](https://www.ansvisor.com)

[![🚀 Try the Cloud — ansvisor.com](https://img.shields.io/badge/🚀_Try_the_Cloud-ansvisor.com-6366f1?style=for-the-badge&logoColor=white&logo=vercel)](https://www.ansvisor.com)
[![📚 Docs](https://img.shields.io/badge/📚_Docs-docs.ansvisor.com-10b981?style=for-the-badge&logoColor=white&logo=readthedocs)](https://docs.ansvisor.com)
[![🎬 Product Tour](https://img.shields.io/badge/🎬_Product_Tour-Watch_the_demo-f59e0b?style=for-the-badge&logoColor=white)](https://app.supademo.com/demo/cmq2b1p5k0rk9qm6ugicrn655)

[![Star on GitHub](https://img.shields.io/github/stars/ansvisor/ansvisor?style=for-the-badge&logo=github&color=gold)](https://github.com/ansvisor/ansvisor)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-green?style=for-the-badge&logo=anthropic)](https://claude.com/claude-code)

# Ansvisor

**Open-source AI Visibility & AI Search Optimization Platform**

</div>

The search landscape is transforming fast. Buyers are moving from traditional search engines to AI platforms like ChatGPT, Claude, Gemini, Google AI Mode, etc.

At Ansvisor, we are building the open future of AI Visibility and AI Search Optimization (AEO/GEO) to help brands claim their spot in AI-generated answers.

What excites us most about Ansvisor is our commitment to a build-in-public and transparent approach.

We believe the future of AI visibility shouldn't be a black box. This field really needs an open platform.

We're incredibly excited to shape what's next alongside our amazing community.

<div align="center">

_Star us to follow along as we ship 👇_

<a href="https://github.com/ansvisor/ansvisor">
  <img src="https://img.shields.io/github/stars/ansvisor/ansvisor?style=social&label=Star" alt="Star Ansvisor on GitHub">
</a>

</div>

### Why Ansvisor?

> AI search is replacing the traditional click. When ChatGPT recommends a product, no Google ranking saves you. Ansvisor measures what classical SEO can't see — how often AI engines name your brand, which competitors get cited instead, and which prompts move the needle. Self-host it for free, or use the managed cloud at [ansvisor.com](https://www.ansvisor.com).

## Features

- **Answer Engine Insights** — Real-time visibility scores across ChatGPT, Google AI Overview, Google AI Mode, Google Gemini, Perplexity, Microsoft Copilot, Grok, and Claude with weekly trend analysis
- **Topics** — Cluster prompts by intent and topic so you can see exactly which themes your brand wins or loses
- **Prompts** — Track unlimited natural-language queries, get AI-generated prompt suggestions based on competitor citations, and analyze monthly search volume per prompt
- **Citations** — See every URL AI engines cite alongside your brand, classified by source type (news, review, owned, social, forum)
- **AI Traffic Analytics** — Tracking pixel that measures real visits arriving from AI answer engines, with platform breakdown, top landing pages, and country segmentation
- **Competitors** — Compare your AI presence against named competitors and surface visibility gaps to close
- **Content Optimization** — AI-generated content briefs (title, outline, target keywords, competitor insights) with one-click webhook delivery to your CMS or workflow
- **Multi-language Support** — 13 languages, 18 regions
- **Self-hosted or Cloud** — Run it on your own infrastructure with every feature unlocked, or use the managed cloud at [ansvisor.com](https://www.ansvisor.com)

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Yarn](https://yarnpkg.com/) (for the web app)
- A [Supabase](https://supabase.com/) project (free tier works)

### Required Services

| Service | Purpose | Where to get |
|---------|---------|--------------|
| **Supabase** | Database, Auth, API | [supabase.com](https://supabase.com/) |
| **AI Provider** (at least one) | Brand tracking across AI engines | [OpenAI](https://platform.openai.com/) / [Google Gemini](https://ai.google.dev/) / [Anthropic](https://console.anthropic.com/) |
| **Cloro** | Web scraping for AI platform responses | [cloro.ai](https://cloro.ai/) |

### Optional Services

| Service | Purpose | Where to get |
|---------|---------|--------------|
| **DataForSEO** | Keyword volume data for prompt analysis | [dataforseo.com](https://dataforseo.com/) |
| **Stripe** | Payments (cloud mode only, not needed for self-hosted) | [stripe.com](https://stripe.com/) |

### Setup

#### 1. Clone and configure

```bash
git clone https://github.com/ansvisor/ansvisor.git
cd ansvisor

cp web/.env.example web/.env.local
cp server/.env.example server/.env
```

Edit both `.env` files and fill in your credentials. See the comments in each file for guidance.

#### 2. Set up the database

Run the migration SQL to create all tables, indexes, RLS policies, and triggers:

**Option A — Supabase Dashboard:**
1. Go to your project's **SQL Editor**
2. For each file in `supabase/migrations/` (in alphabetical order — `00001_…` first, then `00002_…`, etc.), paste its contents and click **Run**

**Option B — Supabase CLI:**

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

##### Demo data (local only)

For local development, `supabase/seed.sql` ships a small fixture (one demo org, brand, prompts, ~120 prompt results across all tracked engines, competitors, content opportunities, AI traffic logs). It runs automatically the next time you do:

```bash
npx supabase db reset
```

Sign in with **`demo@ansvisor.local` / `demo123`** and you'll land on a populated dashboard — no provider API keys needed to iterate on UI. The seed only runs against a local Supabase via the CLI; hosted projects are unaffected.

#### 3. Install dependencies

```bash
cd web && yarn install && cd ..
cd server && npm install && cd ..
```

#### 4. Start dev servers

```bash
# Terminal 1 — frontend
cd web && yarn dev          # http://localhost:3000

# Terminal 2 — backend
cd server && npm run dev    # http://localhost:80
```

### Docker

```bash
# Configure env files first, then:
docker compose up --build
```

### Self-hosted vs Cloud

Set `IS_CLOUD=false` (default) in `server/.env` and `NEXT_PUBLIC_IS_CLOUD=false` in `web/.env.local` for self-hosted mode. All features are unlocked automatically — no Stripe or payment setup needed.

## Project Structure

```
ansvisor/
├── web/                 # Next.js 16 frontend (TypeScript)
├── server/              # Express backend (Node.js ESM)
├── supabase/            # Database migrations and config
├── scripts/             # Version management tooling
├── docker-compose.yml   # Containerized deployment
├── CONTRIBUTING.md
├── CHANGELOG.md
└── LICENSE
```

## Tech Stack

**Frontend** — Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase Auth, Stripe, Zustand, Recharts, next-intl

**Backend** — Express, Vercel AI SDK, multi-provider AI (OpenAI, Anthropic, Google, Perplexity, Grok), Supabase, Socket.IO, Zod

## What's next

What we're planning to build next. React with 👍 on the linked issue (or open a new one) to push something up the list. PRs welcome on any of these.

- [x] **Ansvisor MCP server** — expose insights through a Model Context Protocol server so Claude Desktop, Claude Code, Cursor, Zed, and any other MCP client can query your brand visibility directly. Remote (Streamable HTTP) endpoint at `/api/mcp` — zero install, paste a URL + API key into your client and you're done. Ships with `list_brands` and `get_visibility_summary` today; more tools landing as we go.
- [x] **Anthropic Skills** — opinionated AEO knowledge that turns Claude into an analyst on your account. Ships in two flavours: an MCP-tool flavour for Claude Desktop / Claude Code / Cursor / Zed, and a standalone REST flavour for claude.ai web (no MCP required). First skill (`ansvisor-aeo-coach`) is live — see [`skills/`](./skills). More (page-audit, rewrite-for-aeo, content-brief) on the way.
- [x] **In-product conversational AI assistant** — chat with your dashboard about visibility trends, competitor moves, and content gaps without leaving the page
- [ ] **ScrapeLLM integration** — add ScrapeLLM as an alternative scraping backend alongside Cloro for users who prefer it or need a fallback
- [x] **PostHog integration** — pipe AI-referred sessions and tracking events into PostHog for users already running it as their product analytics layer
- [ ] **Anomaly alerts** — get an email / Slack ping when a brand's visibility drops sharply, a competitor surges, or a high-volume prompt suddenly stops citing you
- [ ] **BYO LLM keys** — bring your own OpenAI / Anthropic / Gemini API key for tracking and content generation, so you control cost and data handling
- [ ] **Webhook recipe library** — one-click Notion / Linear / Asana / Slack templates so a Content Brief can land in your editorial workflow with zero glue code

See an idea missing? Check the [Ideas discussions](https://github.com/ansvisor/ansvisor/discussions/categories/ideas) — upvote an existing one or open a new thread.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch naming, commit conventions, and PR guidelines.

## License

[MIT](LICENSE) — Copyright (c) 2026 Empler AI Inc.
