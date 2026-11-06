# Adding an integration

This guide shows how an integration plugs into Ansvisor today, with Webflow as the worked example. Read it before you pick up an integration issue: a CMS target, an AI bot log source, an export or a directory listing.

For **catalog** connectors (stores and marketplaces that feed Product Visibility), read [`CONNECTORS.md`](https://github.com/ansvisor/ansvisor/blob/main/CONNECTORS.md) instead. Its interface (`connect`, `readCatalog`) is for catalogs only.

## Every connection belongs to a brand

Since brand access (#2050, #2045, #2112), an integration is per brand, never per account. Write yours that way from the start.

- **`integration_accounts`** (00470) is the account's pool of sign-ins: one row per Google login, or per CMS site. It keeps Composio's entity and connected account ids. It never keeps a token.
- **`brand_integrations`** (00470) names the sign-in each brand uses, one per brand and provider.
- **CMS connections** keep the brand's site, collection and field map in `brand_cms_connections` (00283), one per brand and provider. A trigger keeps the pool in step with it.

Code never asks "is the account connected?". It asks for the brand's connection:

- the API server: `brandConnection(brandId, provider)` in `server/src/lib/brand-integrations.js`;
- the web: `web/src/lib/brand-integrations.ts`.

Check the person's access to the brand first (`assertBrandAccess` in `server/src/lib/access.js`). Then read the connection.

## Start from the nearest pattern

| Kind | Copy | Where it plugs in |
|---|---|---|
| Content send (Send to CMS) | `server/src/lib/cms/webflow*.js` | `NATIVE` in `server/src/lib/content-delivery.js` |
| Data read | `server/src/lib/gsc-sync.js` | the daily cron in `server/src/server.js` |
| Catalog | `CONNECTORS.md`, `server/src/connectors/feed-url/` | `server/src/connectors/index.js` |
| AI bot logs | `server/src/lib/bot-log-formats.js` | `READERS` there, and `CONNECTION_KINDS` in `server/src/lib/bot-ingest.js` |

### Worked example: Webflow

Webflow is a Send to CMS target that signs in through Composio. Its parts:

- **`cms/webflow.js`** reads the brand's site, its collections and their fields, and keeps the brand's field map: which field takes which part of a page.
- **`cms/webflow-items.js`** turns a page into a Webflow item. It is pure, so it is tested without a network.
- **`cms/webflow-delivery.js`** sends the page as a **draft** item, or updates the item its last send made. Nothing is published: Webflow's own Publish puts it live.
- **`cms/webflow-status.js`** reads back whether an item went live, and stores the published address. It runs when the Library opens, and once a day for every brand.
- **`routes/cms.js`** has `POST`, `PUT` and `DELETE /api/cms/brands/:brandId/webflow`: connect, save the field map, disconnect. Each is for admins and managers.
- **`content-delivery.js`** registers it in one line, `webflow: { label, connect, send }`, so reserving, batching and retrying come for free.
- **`web/src/components/settings/webflow-card.tsx`** is the card in **Settings › Integrations**.

A target that Composio doesn't have (WordPress, and most open-source CMSs) keeps the brand's own key in `brand_cms_credentials`, sealed by `server/src/lib/cms/credentials.js`. Copy `cms/wordpress*.js`.

### AI bot log sources

A sender posts to `/bots/ingest` with its connection's secret. Only the secret's SHA-256 is stored, and the person sees the secret once (`server/src/lib/bot-ingest.js`). To add one:

1. Add a reader to `bot-log-formats.js`. It reads the body into `{ userAgent, ip, url, status, at, country }` and counts `records`.
2. Add its kind to `CONNECTION_KINDS` in `bot-ingest.js`, so `server/src/routes/bots.js` can make it a connection and the setup screen can show what to paste.
3. Leave verification alone: `server/src/lib/ai-bots.js` keeps only known AI bots from their published IP ranges.

## What every integration ships with

- **A card** in **Settings › Integrations**, or in **Brand settings › Integrations** for a Google sign-in. Every UI string goes in `web/messages/en.json` (next-intl), never in code.
- **Secrets encrypted, never logged.** A key or token never goes in a log line, an error message or a response. Log error codes only.
- **Role checks.** A write route checks the caller's role (`assertRole` or `allowRole`). See **Roles** in [`CONTRIBUTING.md`](https://github.com/ansvisor/ansvisor/blob/main/CONTRIBUTING.md); `server/src/routes/write-roles.test.js` fails until it does.
- **Vitest tests** next to the code (`*.test.js`, `*.test.ts`), against recorded fixtures: a real response saved as JSON, with ids and secrets replaced. Tests never call the network.
- **A Help article** under `help/{area}/{slug}.md`, in the format of [`help/README.md`](https://github.com/ansvisor/ansvisor/blob/main/help/README.md). A new article starts `approved: false`.
- **Self-host behaviour:** without the env vars, the card says "not configured", the action is hidden, and nothing breaks. Add every new env var to the right `.env.example` with a comment and an empty value.
- **Drafts, not publishing.** A content send makes a draft. Putting a page live stays the person's click in their own tool.

## Before you open the pull request

1. Follow [`CONTRIBUTING.md`](https://github.com/ansvisor/ansvisor/blob/main/CONTRIBUTING.md): branch naming, Conventional Commits, and the checks for each package you changed.
2. Fill in the [pull request template](https://github.com/ansvisor/ansvisor/blob/main/.github/PULL_REQUEST_TEMPLATE.md).
3. For any new UI, share screenshots with the maintainers before you open the PR, in light and dark mode at 1024 px.
4. If you need a live account or a key you don't have, finish with fixtures and tests, and say so in the PR. A maintainer runs the live test.
