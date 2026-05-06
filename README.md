<div align="center">

[![Ansvisor Banner](https://cdn.prod.website-files.com/69e606308fb6f96fb911b251/69f0a8f250aa69dd7f6d9a30_s12.svg)](https://ansvisor.com)

[![🚀 Try the Cloud — ansvisor.com](https://img.shields.io/badge/🚀_Try_the_Cloud-ansvisor.com-6366f1?style=for-the-badge&logoColor=white&logo=vercel)](https://ansvisor.com)
[![📚 Docs](https://img.shields.io/badge/📚_Docs-ansvisor.com%2Fdocs-10b981?style=for-the-badge&logoColor=white&logo=readthedocs)](https://ansvisor.com/docs)

[![Star on GitHub](https://img.shields.io/github/stars/aeohub/ansvisor?style=for-the-badge&logo=github&color=gold)](https://github.com/aeohub/ansvisor)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-green?style=for-the-badge&logo=anthropic)](https://claude.com/claude-code)

# Ansvisor

**Open-source Answer Engine Optimization platform**

</div>

Track how your brand appears in answers from ChatGPT, Gemini, Perplexity, Claude, and Copilot. Ansvisor turns AI search into a measurable channel — visibility scores, competitor benchmarks, content optimization briefs, and AI-referral analytics in one self-hostable platform.

### Why Ansvisor?

> AI search is replacing the traditional click. When ChatGPT recommends a product, no Google ranking saves you. Ansvisor measures what classical SEO can't see — how often AI engines name your brand, which competitors get cited instead, and which prompts move the needle. Self-host it for free, or use the managed cloud at [ansvisor.com](https://ansvisor.com).

## Features

- **Answer Engine Insights** — Real-time visibility scores across ChatGPT, Google AI Overview, Google AI Mode, Google Gemini, Perplexity, Microsoft Copilot, Grok, and Claude with weekly trend analysis
- **Topics** — Cluster prompts by intent and topic so you can see exactly which themes your brand wins or loses
- **Prompts** — Track unlimited natural-language queries, get AI-generated prompt suggestions based on competitor citations, and analyze monthly search volume per prompt
- **Citations** — See every URL AI engines cite alongside your brand, classified by source type (news, review, owned, social, forum)
- **AI Traffic Analytics** — Tracking pixel that measures real visits arriving from AI answer engines, with platform breakdown, top landing pages, and country segmentation
- **Competitors** — Compare your AI presence against named competitors and surface visibility gaps to close
- **Content Optimization** — AI-generated content briefs (title, outline, target keywords, competitor insights) with one-click webhook delivery to your CMS or workflow
- **Multi-language Support** — 13 languages, 18 regions
- **Self-hosted or Cloud** — Run it on your own infrastructure with every feature unlocked, or use the managed cloud at [ansvisor.com](https://ansvisor.com)

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
git clone https://github.com/aeohub/ansvisor.git
cd ansvisor

cp web/.env.example web/.env.local
cp server/.env.example server/.env
```

Edit both `.env` files and fill in your credentials. See the comments in each file for guidance.

#### 2. Set up the database

Run the migration SQL to create all tables, indexes, RLS policies, and triggers:

**Option A — Supabase Dashboard:**
1. Go to your project's **SQL Editor**
2. Paste the contents of `supabase/migrations/00001_initial_schema.sql`
3. Click **Run**

**Option B — Supabase CLI:**

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

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

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch naming, commit conventions, and PR guidelines.

## License

[MIT](LICENSE) — Copyright (c) 2026 Empler AI Inc.
