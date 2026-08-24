# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-24

### Added

- **Google Analytics 4 integration** — connect a GA4 account from Settings → Integrations through Composio managed auth, map each brand to one of its properties, and sync AI-sourced sessions, conversions and revenue daily (#695, #703, #718). AI Traffic then reports what AI referrals are actually worth, not just how many arrived, and instances without Composio credentials degrade to a safe no-op
- **Prompts can target several locations at once** — a prompt's tracking locations are now a per-prompt list of countries and US states (`US-CA`), edited from the prompt card with a searchable picker (#783). Plan quota meters the tracked **location** rather than the prompt row, since a prompt tracked in three places costs three times the scraper and model calls; every write path measures the change it makes, so re-saving at the cap succeeds and removing a location frees capacity immediately (#781). Google AI Overview and AI Mode have no sub-country mechanism, so their state locations collapse to one country-wide run instead of billing the identical query twice
- **Per-prompt visibility broken down by location** — a Location control on the Prompts page re-reads the health columns for one tracked location, so a prompt that is strong at home and invisible abroad no longer hides behind a blended average (#784)
- **Pages AI engines ignore** — analytics-backed detection of valuable pages that AI search sends no traffic to, surfaced in AI Traffic and turned into prompt suggestions built from the pages worth defending (#724, #725, #720)
- Prompts: suggestions get their own tab that shows what feeds them (#727), a new prompt is analyzed the moment it is added (#754), and a 7d / 30d / 90d range selector (#697)
- **One date range control** across Visibility, Citations and Prompts, so the three pages can no longer disagree about the window they describe (#722)
- Tracking: an **OpenRouter provider**, with sentiment analysis made provider-agnostic (#708)
- Reports moved into the sidebar (#750)
- Ops: CI flags pull requests that change a migration, so the apply step is not forgotten (#736)

### Changed

- **Citations, Topics and Insights aggregate in Postgres instead of downloading their windows.** The overview pages stopped shipping tens of thousands of rows to the browser to add them up (#726, #744); the per-URL detail page and Competitor Gaps read the citation index instead of paging every answer, which also removed a silent 50,000-row truncation that had been hiding the newest answers from both (#776, #778); and the dashboard serves from daily rollups rather than rescanning history (#773). Citations are written as rows alongside each answer to make this possible (#737, #739)
- Content Optimization generates three opportunities per run instead of five to fifteen, so a run produces work a team can actually act on (#735)
- Prompts: the All Prompts table sorts by visibility score descending by default (#714)
- Citations: source filtering became a segmented control beside the table it scopes, replacing the server-side source filters (#742, #748)
- Relative-time formatting is resolved through one shared helper instead of per-page copies (#767, #772)

### Fixed

- **Security: the citation RPCs enforce organization membership.** Six security-definer functions could be called with any brand UUID by any authenticated user, leaving the tenant boundary to the web tier alone; they now check membership themselves (#779, #780)
- **Settings: organization updates are restricted to admins**, with server-managed columns locked against client writes (#755)
- **A brand's first day no longer sends two Daily Pulse emails** — the catch-up sweep treated the deliberately unpulsed onboarding run as a missed pulse (#774), and a pulse can no longer be sent twice for the same tracking window (#717)
- **Tracking runs survive slow and stalled Cloro queues** — runs whose first result lands late are no longer discarded (#710), ghost tasks no longer hold a run open (#690) or make a watched run sit through the full thresholds (#761), the pending-task read is paged so large runs aren't cut short (#716), and Grok submissions stop while the provider returns 500 for all of them (#734)
- Citations: answers with many citations are no longer dropped by unchunked URL lookups (#738), the stored lookup pages past PostgREST's 1000-row cap (#740), URLs resolve through the request body instead of an over-long query string (#741), "has any citations" is answered without counting every row (#707), content stays visible during refetch (#775), an ambiguous column reference is resolved (#743), and a load failure no longer toasts after leaving the page (#696)
- Prompt volumes: a brand's keywords are analysed when its setup finishes rather than only after checkout (#765), volume analysis covers a whole brand instead of failing past 50 prompts (#747), DataForSEO is asked once per brand instead of once per prompt (#749), and progress is reported from the run and picked up again on reload (#751, #752)
- Reports: sections aggregate in Postgres and a report survives one failing section (#762); query fan-out ranks over the whole window and shows per-engine coverage (#764)
- Content Optimization: filters stay reachable on zero results and selections can be deleted (#733); metrics are calculated across all opportunities (#700); the empty-state Generate button respects the cloud restriction (#699)
- Topic detail trend charts and reports use the AI Visibility Score formula (#685, #693)
- Slugs transliterate non-ASCII letters instead of deleting them (#763)
- CSV: fields containing lone carriage returns are quoted (#758)
- Mobile navigation preferences are aligned with the sidebar (#771)
- Database: the missing `cloro_pending_tasks` migration was added (#692) and the `prompt_suggestions` table definition recovered (#711)
- CI: `messages/*.json` is covered by the format check (#698)

### Docs

- The README is retitled and rewritten around AI Search intelligence (#769, #770)
- Migration 00055's comment is corrected — there was no schema drift (#723)

### Contributors

Huge thanks to everyone who shipped code in this release — and a special welcome to our **first-time contributors**: @mikam44700, @shahzainshafique, @dawNotPoi, @luozejian and @kn-dev-code 🎉

Thanks as well to our returning contributors @BharadwajKanneveti, @Maqbool61 and @Pavel-glitch-ui for coming back with more! 🙌

## [0.2.0] - 2026-08-09

### Added

- **Daily Pulse** — a per-brand digest generated after the daily tracking run: KPI strip (visibility rate, 7-day trend, mentions, citations, sentiment), highlights (first-time citations, top prompt gains, leaderboard overtakes, first appearance on a new engine) and anomaly warnings (sharp visibility drop, competitor surge, high-volume prompt losing citations) with a platform-outage guard and a 7-day warning cooldown. Email via Resend on cloud (active/trialing orgs only), a `daily_pulse.created` webhook event everywhere, and Settings → Notifications for per-brand frequency and recipients (#540, #561)
- **Google Search Console integration** — connect a Search Console account from Settings → Integrations via Composio managed auth, map each brand to one of its properties (unambiguous domain matches are premapped automatically), and sync 28 days of query stats daily with 90-day retention (#577, #642, #643, #644, #647). Prompt suggestions are then **fed by real search demand**: queries the brand actually ranks for but doesn't track yet, filtered for coverage, split into head and long-tail, badged by click behaviour (protect traffic / capture demand / low competition) and enriched with cached competition data — GSC-sourced suggestions carry their source query, impressions and clicks (#648, #650). Brands without a connection keep the existing suggestion flow byte for byte, and instances without Composio credentials degrade to a safe no-op
- **Citations: per-URL detail page** — every cited URL opens onto the answers that cited it, the prompt breakdown behind it, and for brand-owned URLs a bridge to its targeting and traffic (#535, #556), with a paginated prompt breakdown table (#600, #628)
- Prompts: **fan-out coverage in the By-prompt view** — each prompt now shows how many of its tracked answers triggered a live search (`12 / 500 · 2%`) alongside the sub-query count, so prompts the engines never search for finally appear as `0 / N` instead of vanishing from the table (#543, #651)
- Insights: **visibility rate trend chart** with a line per tracked brand and end-of-line logos (#571); a **Formulas dialog** in the header explaining every metric (#581); a Reports shortcut next to Export CSV (#567)
- Tracking: **optional US state-level geo-targeting** for prompts (#579), and brand/competitor **mention positions** are recorded on every result to power the position component of the visibility score (#569, #572)
- Topics: sortable leaderboard columns (#620)
- Exports: CSV for the AI Traffic visit log (#607, #630) and for Competitor Gaps, with an explanation for the intentionally disabled Source Types export (#601, #629)
- Prompts: a citations column on the All Prompts table (#534), engine icons in the fan-out queries table (#542), a search box on the fan-out High frequency view (#593, #615), and pagination plus search on Top Sources (#530, #533)
- Content Optimization: server-side pagination on the opportunities list (#610, #633), and search now queries the whole filtered set server-side instead of only the loaded page — so a match on page 3 stops reading as "no results" (#664, #681)
- Billing: prompt volume analysis is triggered automatically after checkout (#582)

### Changed

- **Visibility Rate is now the AI Visibility Score** — a 0-100 blend of how often AI answers mention the brand (60%), cite its site (25%) and how early it's named among tracked brands (15%), computed identically on every surface: Insights KPI header and trend chart, the leaderboard, All Prompts column and prompt detail, Topics overview and detail, Competitors cards, Reports (new reports; older snapshots keep rendering their stored values), the Daily Pulse email, MCP, the public API and the Looker connector (#573, #574, #575). Coverage (appeared in X of Y prompts) stays visible as a secondary line, and detection remains fully deterministic — no LLM judges
- Prompts: the All Prompts **Visibility column now shows the prompt-level Visibility Rate** (share of runs in the last 30 days with a brand mention or citation) instead of the all-runs average score, which runs without any brand presence diluted into misleading single digits — same rate language as the Insights headline and topic pages; the tooltip keeps run counts and the average score across visible runs, and the CSV export gains `visibility_rate_30d` / `visible_runs_30d` (#562)
- Insights: the **24h view anchors to the last completed tracking run** instead of a wall-clock window, so the KPI header, the dashboard and the Pulse email always describe the same slice (#578); the trend chart plots the rolling selected window so it can never disagree with the headline (#576)
- Reports: prompt and topic performance ranks by visibility rate rather than the diluted average (#568)
- Metrics: the position factor is shrunk by mention evidence and its full support raised to 20 mentioned answers, so a single lucky first mention no longer reads as dominance (#584, #585)
- Competitors and topic detail surface the prompt-level visibility rate (#493, #555)
- Platform display labels are resolved from one shared map instead of per-page copies (#553)
- Prompts: pagination unified with the shared `TablePager` (#544, #546)
- Ops: the cloud daily-tracking cron moved to 02:00 UTC (05:00 TR) — self-host schedules are unchanged and stay configurable through `DAILY_CRON_SCHEDULE`; the server image defaults `NODE_ENV` to production, and CI now runs a full Next.js production build (#528)
- Insights: unused chart components removed (#589, #625)

### Fixed

- **Tracking runs tolerate delivery gaps and refuse to stamp partial runs** — the stall window is configurable (`CLORO_STALL_POLL_LIMIT`) and a run that produced far fewer results than it planned no longer becomes the 24h anchor, which previously let a half-delivered night rewrite the dashboard and the Pulse email with numbers nobody could reproduce (#649). Run result counts are read back from the database when stamping, so scraper-only brands no longer stamp zero (#583)
- **Pulses lost to process death are recovered** by a daily catch-up sweep: any brand whose latest completed run never produced a pulse gets one dated to that run's day, with double-sends made impossible by the existing unique key (#654). The pulse also waits for the brand's scraper queue to drain before computing, so the email can't report a partially-delivered window (#570), and `PUBLIC_APP_URL` is normalized to an origin so email links stop pointing at doubled paths (#639, #641)
- Content Optimization: opportunities and briefs are generated **in the brand's language** instead of always English (#638, #640); dismiss actions are gated behind a confirmation dialog for bulk and an undo toast for single rows (#611, #653); stale responses can no longer overwrite the list on rapid filter changes (#663, #682)
- Site Audit: a persistent error card with retry replaces the blank page on load failures (#666, #678); re-run is guarded against double clicks that started two audits and spent two units of quota (#667, #677); the trend chart groups by local day so timezone-shifted audits stop producing duplicate labels (#668, #675); deleting an audit refreshes the trend card and quota (#669, #674); polling timeouts render a real state (#612, #632)
- Error states with retry replace silent failures or misleading empty states across Citations (#599, #623), Topics (#595, #618), prompt detail (#591, #627), prompt suggestions (#609), invoices (#559), agent actions (#551, #646), prompt workflow validation (#549, #645), invites (#566), `savePromptSet` (#536) and `addPromptToSet` (#580)
- Citations: the Region filter is populated from observed data (#598, #622) and YouTube video IDs survive URL normalization (#558)
- Topics: renaming a topic no longer zeroes its prompt count — prompts are counted by `topic_id` instead of category name (#594, #617); the CSV export writes the real `topic_id` instead of an always-empty column (#590, #626); KPI strings are pluralized with aligned decimal formatting (#619)
- AI Traffic: chart date labels are correct across timezones (#605, #621), platforms with zero visits are filtered out of the breakdown (#616), and the empty state is period-specific (#608, #631)
- Site Audit hub: the empty state no longer flashes while loading, and failures or a missing brand no longer render as "no audits yet" (#613, #624)
- Accessibility: insights tooltips and legends are keyboard/screen-reader reachable (#588, #604); the audit range toggles, URL input and signal panels expose their state (#671, #672); Content row actions and the search input have accessible names (#665, #679)
- i18n: the audit hub and report render from message keys instead of hardcoded strings, including status labels that previously leaked raw enum values (#670, #673)
- Formatting: mention/citation counts use thousands separators (#603) and the metric breakdown sheet pluralizes day and mention counts (#602)
- Insights: the Share of Voice pie tooltip explains both of its numbers (#565)
- Competitor aggregates drop rows for deleted competitors (#560)
- Agent: max output tokens raised so long answers stop truncating (#563)
- API: the rate limiter keys on the auth token instead of the client IP, so users behind a shared NAT stop throttling each other (#537)

### Docs

- A custom `robots.txt` with explicit AI-crawler allowances and a sitemap reference (#634)

### Contributors

Huge thanks to everyone who shipped code in this release — and a special welcome to our **first-time contributors**: @arambu1a, @Adarshhic, @Pavel-glitch-ui, @marceli1404, @Jesulac, @MFA-G and @abdulm5 🎉

Thanks as well to our returning contributors @d180, @BharadwajKanneveti, @abdullah91111 and @Maqbool61 for coming back with more! 🙌

## [0.1.7] - 2026-07-25

### Added

- **Reports: templates with a section picker** — four ready-made templates (Weekly Visibility Summary, Monthly Executive Report, Competitor Benchmark, Citation & Sources Report) pre-select a section set the user can toggle per report; four new modules, previous-period deltas and a change-story executive summary (#419), plus mention & citation evidence sections (#444)
- **Public metrics API v1** under `/api/v1`, with docs (#422)
- **Looker Studio Community Connector** (#426)
- Insights: **Visibility Rate is the headline metric** — the prompt-level rate (appeared in X of Y tracked prompts) leads the KPI header and the competitor leaderboard (#490); period-aware Tracked Prompts KPI card with the plan quota (#471); Topic & Prompt Opportunities teaser cards (#459, #479); a refetch overlay while filter changes reload data (#494); head-to-head links on the leaderboard (#506); a no-competitors teaser pointing to the Competitors page after its sidebar entry was removed (#504, #507, #519)
- Prompts: **prompt workflow** — a work status (todo / in progress / done), a notes thread, and target URLs with automatic "cited" tracking as new results arrive, surfaced on both the detail page and the All Prompts table (#511); Add Prompt dialog on the All Prompts tab (#483); edit/delete a prompt in place (#484, #487); **Top Sources card** (Domains/URLs tabs) on the prompt detail page (#495) with an Insights-style date-range filter (#496)
- Topics: **persisted AI topic suggestions** — generated from prompt-data gap signals, stored with accept/dismiss, plan-gated refresh (#463, #497); the overview table, Best/Weakest KPIs and CSV export lead with the prompt-level Visibility Rate (#493, #499); topics can be created directly from the Topics page (#522)
- Citations: CSV export for Top Domains / Top URLs (#449); Source Types moved into a full-width sources-card tab (#486, #488)
- Traffic: pagination and filtering for AI referral visits (#454); a 7/30/90-day range picker (#481), upgraded to a full date-range picker (#509)
- Billing: **Stripe Customer Portal** access from Settings → Billing (update payment method, billing address and VAT/tax ID), and checkout now collects billing address and tax ID up front (#524)
- MCP: topic suggestion tools — list, accept and dismiss (#513)
- Plans: Claude tracking is gated to Enterprise per-customer opt-in on cloud (#423)
- Onboarding: the plan step clarifies that the card is not charged until the trial ends, with a Stripe trust line (#503)
- Sidebar / Mobile nav: Agent nav item shows a **"Set up"** badge on cloud when the org has no Anthropic API key saved; self-host instances are unaffected (#456, #472)

### Changed

- Sidebar: Prompts moved above Topics in the Analytics group (#531)
- Models: Claude tracking upgraded to `claude-sonnet-5` (#421); the duplicated model display-name maps were centralized in one config (#501)
- Prompts: suggestions moved to the All Prompts tab (#466) and collapse to a one-line strip by default — zero suggestion requests until expanded (#470); Query Fan-out opens on the By Prompt view by default (#453)
- Insights: removed the Prompt Results by Topic tree (#458, #477)
- Citations: the default date preset is now 24h, with a period-aware empty state (#485, #489)
- i18n: the Insights (#518), Topics (#517) and Agent (#516) pages are wired to next-intl

### Fixed

- Billing: **monthly quotas anchor to the subscription billing period**, not the calendar month — an org renewing mid-month gets its allowance back at renewal (#500)
- Insights: **Positive Sentiment divides by brand-mentioning answers** — the score is no longer diluted by answers that never mention the brand (#508, #512); zero-base deltas render as "+N new" instead of a meaningless percentage (#520, #521); brand and competitor averages share the same denominator (#478)
- Tracking: Perplexity query fan-out survives the upstream switch to a plain string-array `search_model_queries` — the parser now accepts both the new string entries and the legacy object shape (#525)
- Reports: the KPI section leads with the visibility rate, with a fallback for old snapshots (#515); the AI executive summary reads `*Change` fields as percentage deltas and never implies an impossible previous value (#514, #520, #521)
- Citations: citation counts are hostname-based with an automatic recount when brand domains change (#433); chatgpt-shopping rows are excluded to match the Insights KPIs (#434); overview and gaps scans page past the silent 1000-row cap (#430)
- Topics: the overview scan paginates and excludes chatgpt-shopping (#465)
- Traffic: exact visit counts with paginated breakdown/trend scans (#468)
- Prompts / Query Fan-out: complete aggregation with bounded fetches and real error messages (#428); intents classify progressively — visible page first (#448); the High frequency pager is windowed (`‹ 1 … n-1 n n+1 … last ›`) instead of one button per page (#446, #455); suggestion refresh no longer fails on high-volume estimates (#480); the page's first load is consolidated into one server action (#473); tab/sort URL params update shallowly without a full navigation (#474); loading spinner styles aligned (#482)
- Onboarding: LLM suggestion calls retry and fall back to manual entry (#443); Back/Continue no longer duplicates brands (#467)
- Shopping: product prices are rounded and formatted (#418); chatgpt-shopping stays off brands that have Shopping disabled (#432)
- Content: generated opportunity titles/descriptions no longer leak prompt indexes (#442)
- i18n: template name lookups are guarded with `t.has()` to prevent MISSING_MESSAGE crashes (#425); the proxy bypasses next-intl for RSC and server-action requests (#475)
- MCP: prompt-level visibility rate exposed and the competitor average denominator fixed (#491, #502)
- Web: all outstanding ESLint warnings resolved (#437, #526)

### Docs

- Platform guide for Reports — templates, section picker, PDF export (#438, #527)
- README: Blog added to Resources; website links cleaned up

### Contributors

Thanks to everyone who contributed to this release, including @Maqbool61, @d180, @chinmaywadhe26, @abdullah91111, @Dodothereal, @BharadwajKanneveti, @Utkarsh-Singhal-26 and @Sam-syntax35! 🙌

## [0.1.6] - 2026-07-12

### Added

- **Reports (Simple Reports MVP)**: generate an immutable snapshot report for a brand over a chosen period — AI-written executive summary, KPI cards with deltas, visibility trend chart, share of voice, competitor leaderboard, best/weakest prompts, observed query fan-outs, and top citation sources — plus a report library and a true **vector PDF export** (selectable text, smart page breaks, embedded Inter so Turkish characters render correctly). Soft-launched: reachable at `/dashboard/reports`, no sidebar entry yet (#390)
- Prompts / Query Fan-out: **Intent column** — sub-queries are classified once via LLM and cached, so intents load on demand everywhere after (#333, #353)
- Prompts / Query Fan-out: **By Prompt** grouped view — expand any tracked prompt to see the sub-queries its answers actually ran (#358)
- Prompts / Query Fan-out: the high-frequency table is paginated at 10 rows per page with numbered controls (#349, #355)
- Insights: the result detail now shows the query fan-out captured for that answer (#362)
- Content: the opportunity's Source Data card shows the related prompt's observed query fan-outs — first-hand demand signal next to the estimated keywords (#392, #405)
- Content: bulk **Done** button for selected opportunities (#356), and opportunities are generated in the brand's language (#369)
- Agent: completed Site Audit results render inline in the chat as an audit card (score gauge, category breakdown, top recommendations) instead of raw JSON (#272, #386), and assistant messages gained a copy button (#371, #374)
- Shopping: provider logos replace raw platform slugs in the product tables (#398, #401)
- Citations: the Top Sources **Domains and URLs tables are paginated** at 100 rows per page with globally continuous ranks and per-tab page state (#395, #411)
- Teams: removed the member seat limit on cloud plans (#373)

### Changed

- Sidebar: "Answer Engine Insights" is now **Visibility** and "Content Optimization" is now **Content** (#391)
- Insights: the page title is wired to next-intl (part of #384) (#389)
- Prompts: removed the misleading Keywords and Multiplier columns from the Prompt Volumes table (#347, #359), and large counts use the shared compact number formatter (#348, #370)

### Performance

- Insights: the initial load no longer scans the full results table — counts and limits moved into SQL (#313, #352)
- Citations: domain and article-type classifications are memoized per load (#366, #375)

### Fixed

- Shopping: **ChatGPT Shopping cards were captured but never reached the dashboard** — the normalizer had no ChatGPT branch, so only Copilot cards ever showed. Added the parser (derived from real captured payloads), fixed thousand-separator price parsing ("₺2.699,99" no longer reads as 2.699), and history is recoverable via the existing backfill script (#399, #408)
- Shopping: filter selects show readable labels instead of raw values (#396, #397)
- Onboarding: the competitor step can no longer be skipped without adding at least one competitor (#377, #378)
- Content: sending to a workflow with none connected shows a short "No workflow connected" error instead of a redacted production stack message — single and bulk send (#393, #400)
- Content: filter selects show their labels in the trigger (#364, #368), and the list no longer flashes a skeleton on filter changes or bulk actions (#367)
- Prompts: fan-out intent badges paint together with the table instead of popping in (#380, #387); tracking a fan-out query updates the row in place without a skeleton flash (#346, #407) and reflects on All Prompts (#357); the unanalyzed banner says prompts, not keywords (#381, #388); navigating away mid-load no longer fires a spurious "Failed to load prompt data" toast (#394, #402)
- Topics: KPI cards no longer render a bare `0pts` delta when the change is zero (#360, #410)
- Citations: the competitor filter shows the competitor's name in the trigger instead of its id (#344)

### Docs

- README and docs: Ansvisor mentions, the docs topbar logo, and managed-cloud references now link to the website (#376)

### Internal

- Server: structured logging final slice — the Cloro scraper joined the pino migration (#351)

### Contributors

Thanks to everyone who contributed to this release, including @Sam-syntax35, @Maqbool61, @d180, @prakashiitp, @BharadwajKanneveti and @AyushSrivastava1818! 🙌

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
