# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-07-06

### Added

- Query Fan-out: the observed sub-queries answer engines actually run while building your answers are now captured and surfaced. Tracking stores the fan-out returned by Cloro (`prompt_results.search_queries`, no extra scraper spend), and a new **Query Fan-out** tab on `/dashboard/prompts` lists the distinct sub-queries with how often each was searched, the source engines, the prompts they came from, and a one-click "+" to promote any of them into a tracked prompt (#341, #342)
- Citations: **Competitor Gaps** — a view of domains that cite your competitors but not you, with a per-competitor source map so you can see exactly who's earning those citations (#326, #327)
- Citations: add a cited domain as a competitor inline with a "+" straight from the Domains table (#329)
- Citations: hover any prompt in the prompt filter dropdown to read its full text (#324)
- Prompts: sortable columns on All Prompts (visibility / mentions / volume / last run) with the active sort deep-linked in the URL (#322)
- Prompts: a banner surfaces keywords that haven't had volume analysis yet, with a one-click Analyze action (#296)
- Brands: pause a brand — a paused brand keeps all its history but is skipped by the daily tracking cron and on-demand runs, so it spends no Cloro/LLM credits until resumed (#308)
- MCP: run a Site Audit from any MCP client (`run_site_audit` + `get_site_audit`, quota-charged), plus `list_site_audits` and `get_site_audit_quota` read tools (#305, #306)
- Assistant: the in-product AI assistant can now run a Site Audit itself, and `list_citations` gained a `source_filter` so it can isolate owned / competitor / external citations (#307, #311)
- Traffic: only platform-attributable AI visits (a real AI referrer or a known `utm_source`) are persisted now — unattributable "unknown" hits are dropped (#310)
- Billing: the free trial is now 14 days, up from 7 (#319)
- Insights: the region filter shows readable region names instead of raw codes (#315, thanks @Peter7896)

### Changed

- Server: structured logging Phase 2 — the remaining `console.*` calls across the routes (request-scoped `req.log`), workers, job manager/runner, `server.js`, middleware, and lib/config were migrated to the `pino` logger, so production logs are leveled, JSON-formatted, and correlatable by request id (#330, #334, #335, #336, #337)
- Server: consolidated the intent-extraction logic into a single shared module (#302)
- Web: centralized the API base-URL configuration so every server action resolves it one way (#292, thanks @BharadwajKanneveti)
- Content Optimization: reordered the KPI cards so Avg. Score comes before Sent to Workflow (#321)
- Insights: the metric breakdown rows are now sorted by their current value (#320, thanks @Peter7896)
- Self-host: ship a generated consolidated `supabase/schema.sql` so a fresh install can be created from one file instead of applying every migration by hand (#331)
- Brands: removed unused imports in the brand settings page (#323)

### Performance

- Topics: opening a topic is much faster — the detail page's six serialized server-action calls were collapsed into one action that runs the reads in parallel server-side (#338)
- Citations: switching between the Domains and URLs tabs is now instant (`keepMounted` + memoization) (#325)

### Fixed

- Team: the "share this link directly" invite link now points at the self-contained `/invite/{token}` accept page instead of an email-only `/auth/confirm` URL, so a shared or copied invite no longer 404s to `?error=auth_confirm_missing_params`; re-inviting a removed member works end to end, and the invite dialog is honest about whether an email was actually sent (#340)
- Billing: non-admin members are blocked from the payment/onboarding screens when an organization's subscription lapses (only admins settle billing) (#317)
- Billing: trialing subscriptions are treated as active in the web plan-guard, so trial users aren't gated out of paid features (#285)
- Insights: the visibility score is no longer floored to 0, so sub-1 averages stay visible (#283)
- Site Audit: AI fix recommendations are anchored to the current date instead of drifting to a stale one (#284)
- Traffic: the tracking beacon is sent as `text/plain` so it stays a CORS-safelisted request and isn't silently blocked (#287)

### Docs

- README: added the AI Visibility Glossary to Resources (#318) and listed Scrape.do under Optional Services for the Site Audit page fetcher (#295)
- Documented `SCRAPEDO_API_KEY` and `AUDIT_LLM_MODEL` for Site Audit in the env references (#294)

### Contributors

Thanks to everyone who contributed to this release, including @Peter7896 and @BharadwajKanneveti! 🙌

## [0.1.4] - 2026-06-21

### Added

- Site Audit: AEO/GEO page scoring under Content Optimization — fetches any URL (Scrape.do proxy + JS render) and scores it across 47 weighted signals in five categories (structure, content, authority, E-E-A-T, trust) using deterministic evaluators plus a batched LLM pass, then returns prioritized, AI-written fix recommendations. Runs asynchronously with live progress, a per-audit detail page at `/dashboard/audit/[id]` (re-run + delete), a primary-domain score trend and category breakdown on the hub, and a monthly per-plan quota (#259, #261, #262, #263, #264, #265, #268)
- Server: structured logging — a `pino`-based logger with levels (`LOG_LEVEL`), per-request correlation IDs (`x-request-id` + per-request child loggers), JSON output, and sensitive-header redaction; the per-request access log dropped to `debug` so it's off by default in production (#273, thanks @Pallavikumarimdb)
- Citations: expanded the source-category domain lists so more citations classify into the right bucket (#276, thanks @BharadwajKanneveti)

### Changed

- Performance: dashboard charts (Recharts) are now lazy-loaded via `next/dynamic` with skeleton fallbacks, trimming the initial route JS across Insights, Shopping, Citations, Topics, Traffic, Prompts, and the Agent panel (#281, thanks @BharadwajKanneveti)
- Insights: the date range now defaults to the last 24h instead of all-time (#274, thanks @Srija-65)
- Insights: clearer "Queued — starting automatically" copy when an analysis is waiting behind another run (#280)
- Web: dropped the unused `framer-motion` dependency (#266) and removed a deprecated unused `Project` type (#258) (both thanks @BharadwajKanneveti)

### Fixed

- Tracking: the "Analyze Prompts" action no longer re-analyzes prompts that already have results — closes a double-spend where the same prompts could be submitted several times during the async webhook window (#278)
- Tracking: the analysis progress bar no longer freezes partway on webhook-mode runs — the drain loop now counts only the current run's tasks (not brand-wide orphans), gives up early if delivery stalls, and a periodic sweep clears orphaned pending-task rows (#279)
- Shopping: Microsoft Copilot `shoppingProducts` wrappers are flattened into per-product cards instead of a single "Unknown Product" (#255)
- Web: switching brand tabs no longer flashes a spurious "Failed to fetch" toast from the aborted in-flight request (#257, thanks @gitbasitmalik)

### Tests

- Server: closed the remaining server-side test gaps tracked in #125 (#256, thanks @Pallavikumarimdb)

### Docs

- Added `CRON_SECRET` to both `.env.example` files, with a note that it's cloud-only and must match on the web app and the server (#277, thanks @P-Maheswari)

### Contributors

Huge thanks to everyone who contributed to this release — and a special welcome to first-time contributors @gitbasitmalik, @Srija-65, and @P-Maheswari! 🎉 Thanks also to @Pallavikumarimdb and @BharadwajKanneveti. 🙌

## [0.1.3] - 2026-06-14

### Security

- Internal API routes now enforce org/brand ownership on every request — closed a set of IDOR gaps where a `:brandId` / `:id` / `:jobId` in the URL was trusted without checking it belonged to the caller's organization (tracking, content, and volumes routes) (#246)
- Enabled Row Level Security on previously exposed tables: `jobs` and `prompt_volumes` (server-only, no client policy) and `competitors` / `topics` (org-membership-scoped member policies mirroring `content_opportunities`) (#250)
- The on-demand tracking endpoint (`POST /api/tracking/check`) now goes through the same cloud cost guard as `analyze-new` — inactive subscriptions get 402, daily-cap / cooldown get 429 — so it can no longer bypass quota on cloud (#252)
- Cloro callback (`/cloro/callback`) now verifies the webhook signature before processing (#229)
- Aggregate / row-fetch RPCs flipped to `SECURITY INVOKER` so they run with the caller's RLS context instead of the definer's (#200)
- RBAC: write controls on Manage Prompts / Manage Topics are hidden for non-admin/manager roles, and Settings → Agent Save/Remove is gated behind admin (#141, #142)

### Added

- Shopping: end-to-end Shopping suite — brand-level Shopping mode toggle, ChatGPT Shopping platform, normalized `prompt_result_shopping_cards` with a parser worker, sidebar entry + overview page, My Products / Competitors tabs with brand matching, a card-eligible prompts tab, and Insights isolation (#143, #144, #155, #157, #176, #178; #176 and #178 thanks @Pallavikumarimdb)
- Agent: `render_chart` tool with inline Recharts visualizations in the chat panel (#138)
- Content: monthly quota for content brief generation (#224)
- Citations: "Own domain only" filter to isolate first-party citations (#164, thanks @Pallavikumarimdb)
- Auth: password visibility toggle on the auth forms (#210, thanks @MaitreyeeDeshmukh)
- Onboarding: in-app Product Tour button (#225, thanks @gaoharimran29-glitch)
- MCP: `get_ai_traffic` (#148), `get_prompt_volumes` (#160), `list_shopping_cards` / `get_product_visibility` (#177), and prompt-level performance aggregation (#181) tools — each with a parallel REST endpoint (#148, #177, #181 thanks @Pallavikumarimdb)
- Tests: Vitest infrastructure for both `web/` (#202) and `server/` (#249), plus unit tests for the CSV serializer (#219), `classifyDomain` / hostname helpers (#248), and `parseResponse` / `countBrandMentions` (#251) (all thanks @Pallavikumarimdb)
- CI: lint + CI pipeline for the `server/` package (#201, thanks @Pallavikumarimdb)
- DX: seed now populates raw `prompt_results.shopping_cards` so the demo dashboard shows shopping data out of the box (#232)

### Changed

- Plans: server plan limits now read from the same source of truth as the web app, so cloud quotas stay in sync (#223)
- Sidebar: tighter nav-item density (#166), removed the redundant Settings entry (#167), and moved the collapse toggle above the profile row with a restyle (#168)
- Brands: brand list cards slimmed to a nav-menu shape (#154, #156), typography aligned with the Insights page (#179), softened active-card outline (#175), bolder breadcrumb avatar fallback (#174)
- Agent: today's date is injected into the system prompt so time-window queries ("last 7 days") resolve correctly (#137)

### Fixed

- Brands: page no longer crashes — `buttonVariants` is now server-safe (#230)
- Auth: the full reset-password flow is wired end-to-end (#151, #171)
- Insights: show platform totals (#172, thanks @nanookclaw); group results by platform on both the insights and prompt-detail views (#235, #237, thanks @VrtxOmega); CSV export writes platform display names instead of raw slugs (#234); moved the raw results count out of the page header (#238)
- Tracking: cloud snippet points at `api.ansvisor.com` (#218); Shopping sidebar entry is gated by the active brand instead of org-wide (#170, #173)
- Team settings: show the role label instead of the raw enum value (#147, thanks @akagifreeez)
- UI: ChatGPT avatar stays visible in light mode (#162, thanks @nanookclaw); `PasswordInput` merges caller `className` via `cn` (#212, thanks @MaitreyeeDeshmukh); icon-only buttons across the dashboard now have accessible names (a11y) (#253, thanks @BharadwajKanneveti)
- Billing: removed a stray debug log from the Stripe checkout route (#184, thanks @krishnaprasharkp)
- Self-host: Docker Compose image tags sync with the package version (#185, thanks @xianzuyang9-blip)

### Docs

- Added a Code of Conduct (Contributor Covenant) (#247), a backend `server/` README (#188, thanks @titanniya542-spec), and fork instructions in CONTRIBUTING (#135, thanks @ayobamiseun)
- Repo: GitHub issue forms + PR template (#233); README polish — Resources section, single H1 tagline, product-tour badge, banner image, `www` links, and marking the in-product AI assistant as shipped (#165, #197, #207, #214, #215, #216; thanks @beanscg, @n1dhiparate, @xzlknr)

### Contributors

Huge thanks to everyone who contributed to this release: @Pallavikumarimdb, @MaitreyeeDeshmukh, @n1dhiparate, @nanookclaw, @VrtxOmega, @ayobamiseun, @akagifreeez, @beanscg, @xzlknr, @titanniya542-spec, @xianzuyang9-blip, @krishnaprasharkp, @gaoharimran29-glitch, and @BharadwajKanneveti. 🙌

## [0.1.2] - 2026-05-31

### Added

- In-product AI agent: chat panel grounded in the MCP read tools, available on every cloud plan via BYOK — paste your own Anthropic API key in Settings → Agent. Self-host uses `ANTHROPIC_API_KEY` from env (#120, #121)
- Settings → Agent: org-level Anthropic API key management for cloud customers; AES-256-GCM encrypted at rest, only `last4` + saver metadata visible to org members, save/clear is admin-only (#121)
- MCP: `generate_content_brief` tool that triggers the brief endpoint (#109)
- MCP: `update_opportunity_status` tool for workflow transitions (#110)
- MCP: `get_competitor_comparison` tool with share-of-voice (#116)
- MCP: `list_citations` tool + REST endpoint (#117)
- MCP: `get_visibility_trend` tool (visibility time-series) + REST endpoint (#118)

### Changed

- Insights: aggregate insights data in Postgres instead of pulling rows into Node — meaningful drops in p95 for orgs with large prompt-result tables (#114)
- Repo: renamed from `aeohub/ansvisor` to `ansvisor/ansvisor`; all internal links + docs updated (#102)
- Marketing: removed the in-app `/pricing` page; canonical pricing lives on `ansvisor.com/pricing`, and `/pricing` on the app redirects there (#119)
- CI: ESLint now runs in CI alongside Prettier and TypeScript (#128, thanks @ayobamiseun); the 8 existing lint errors lurking in the codebase were cleared in the same window so the new check stays green (#133)

### Fixed

- Invite flow: clicks on invite emails now route through a new `/auth/confirm` route handler that does server-side `verifyOtp` and writes the session cookie before the user lands on the accept page. The previous flow ejected invitees to `/sign-up`, where Supabase's silent duplicate-signup obfuscation left them with no password set; the accept card now also asks for a password + full name before joining so the user can sign back in (#127, #129, #130)
- Onboarding: align prompts to the selected plan's engine set on Stripe checkout success — Starter customers no longer see Growth-only platforms after upgrading via the onboarding flow (#111)
- Billing: same alignment runs on every plan-change path (PATCH subscription, webhook, downgrade) so prompts stay consistent with the active plan regardless of which surface fired the change (#112)

## [0.1.1] - 2026-05-26

### Added

- MCP server with API keys + `list_brands` and `get_visibility_summary` tools, exposed at `/api/mcp` (#20)
- MCP: `list_prompts` / `get_prompt` and `list_topics` / `get_topic` tools, plus parallel REST endpoints (#35)
- MCP: `list_content_opportunities` / `get_content_opportunity` tools + REST endpoints (#74)
- Anthropic Skills: Ansvisor AEO Coach ships in two flavours — MCP tool for Claude Desktop / Code / Cursor / Zed, and standalone REST for claude.ai web (#23)
- Analytics: PostHog + Vercel Analytics with self-host opt-in posture (#13)
- Analytics: universal user identification and onboarding-funnel instrumentation (#30)
- CSV export buttons on Topics (#53), Prompts (#54), and Answer Engine Insights (#73)
- Citations: searchable prompt combobox filter (#55)
- Sidebar: user profile chip (avatar + name) linking to settings (#52)
- Prompts: Competition column with a 5-bar difficulty meter (#82)
- Tracking: capture Perplexity `shopping_cards` into `prompt_results` (#83)
- Tracking: capture Google AI Mode `shoppingCards` into `prompt_results` (#86)
- Tracking: capture Microsoft Copilot `shoppingCards` into `prompt_results` (#87)
- DX: `supabase/seed.sql` ships a populated local dashboard (one demo org, brand, prompts, ~120 prompt results, competitors, content opportunities, AI traffic logs) — `demo@ansvisor.local` / `demo123` (#75)
- Tooling: Prettier configuration + CI workflow (format check & typecheck) (#80)

### Changed

- README: replaced the intro with a build-in-public manifesto (#90)
- README / docs metadata: tagline updated to "AI Visibility & AI Search Optimization" (#89)
- Docs: rewrote "What is Ansvisor?" around AI Search Visibility / GEO / AEO (#92)
- README: stargazers CTA above "Why Ansvisor?" (#77)
- Onboarding: signout button in the bottom-right corner (#68)
- Settings: contact-us CTA opens the contact page (#81)
- CI: auto-welcome first-time contributors on PRs only (#34, #59)

### Fixed

- Billing: block tracking + features for orgs without an active subscription (#56)
- Citations: group raw model slugs under display names in the Platforms filter (#48)
- Insights: adaptive Y-axis on the Brand vs Competitors chart (#37)
- Insights: silence navigation-cancellation toast (#70)
- MCP: use the app URL for the MCP endpoint (#33)
- UI: ComboboxTrigger overflow — respect caller width and clip long values (#91)
- Onboarding: preserve pending content opportunities (#63)
- UI: sign-in / sign-up header logo points at the marketing site (#57)
- UI: remove unused dashboard layout header (#36)
- Refresh stale package-lock metadata (#51)

## [0.1.0] - 2026-04-09

### Added

- Initial open-source release
- Web frontend (Next.js 16) with dashboard, analytics, and content optimization
- Backend server (Express) with multi-provider AI tracking (ChatGPT, Gemini, Perplexity, Grok, Claude)
- Docker Compose setup for self-hosting
- Multi-language support (13 languages, 18 regions)
- Plan-based feature gating (self-hosted, starter, growth, enterprise)
- Real-time brand visibility monitoring across AI search engines
- Competitor tracking and content optimization suggestions
- Prompt volume analysis
- Stripe integration for cloud billing
