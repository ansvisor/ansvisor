# Ansvisor Looker Studio Community Connector

Brings the [Public Metrics API](https://github.com/ansvisor/ansvisor/blob/main/docs/api-reference/metrics.mdx) into Looker Studio so Ansvisor metrics can sit next to GA4 / Search Console data in one dashboard.

**Metric sets** (each is one data source):

| Set                        | Fields                                                                           | Backing endpoint                |
| -------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Visibility Trend (daily)   | date, avg visibility, mentions, citations, tracked results, avg competitor score | `/api/v1/visibility-trend`      |
| Share of Voice by Platform | platform, brand mentions, competitor mentions, SoV %                             | `/api/v1/competitor-comparison` |
| Citations — Top Domains    | domain, source category, citations, results citing, usage %                      | `/api/v1/citations`             |
| AI Traffic by Platform     | platform, visits                                                                 | `/api/v1/ai-traffic`            |

Auth is an Ansvisor API key (dashboard → **Settings → API Keys**). The report-level date range flows into every request; responses are cached for 5 minutes per user.

## Deploying (maintainers)

1. Create an Apps Script project at [script.google.com](https://script.google.com) (or `npx clasp create --type standalone` in this directory).
2. Copy `Code.js` and `appsscript.json` into the project (enable _Show "appsscript.json" manifest file_ in project settings, or use `npx clasp push`).
3. **Deploy → New deployment → Library-less "Add-on" type is not needed** — use _Deploy → Test deployments_ for development, and _Deploy → New deployment_ to mint a versioned deployment for sharing.
4. Share the connector with users via its deployment link: `https://lookerstudio.google.com/datasources/create?connectorId=<deploymentId>`.

Publishing to the partner gallery is a separate, later step (Google review, verified branding, published privacy policy / terms).

## Using (agencies)

1. Open the deployment link above → Looker Studio prompts for authorization.
2. Paste your `ans_...` API key.
3. Pick a brand and a metric set → **Connect**.
4. Add the data source to a report; blend with GA4 on the `Date` field for the visibility-vs-traffic view.

## Self-hosting notes

- Change `BASE_URL` in `Code.js` **and** the `urlFetchWhitelist` entry in `appsscript.json` to your web app's origin, then deploy your own copy.
- `logoUrl` currently points at the GitHub org avatar (`https://github.com/ansvisor.png`); replace with a hosted square PNG before any gallery submission.
