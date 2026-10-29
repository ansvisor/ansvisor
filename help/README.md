# Ansvisor Help

The product knowledge base Chat answers how-to questions from (CHAT-19 §4): one article per page, feature, metric, setting and main task of the live app. Chat answers only from articles with `approved: true`, one short section at a time, and opens the article's `route` with a page card.

## Where

`help/{area}/{slug}.md`, one folder per area: `getting-started`, `visibility`, `prompts`, `mentions`, `citations`, `competitors`, `content`, `site-audit`, `action-center`, `ai-traffic`, `reports`, `settings`. The slug is the file name, in kebab-case.

## Front matter

```yaml
---
title: Add prompts to track
route: /dashboard/prompts/tracked
keywords: [add prompt, bulk import, track]
synonyms: [new query, add questions]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/prompts.mdx]
---
```

- `route`: the page the article is about, an address of the app (Settings sections by their name, `/dashboard/settings/team`).
- `keywords` (3 or more) and `synonyms`: the words people ask with.
- `plan`: the lowest plan the feature needs (`all`, `starter`, `growth`, `enterprise`). Plan limits and prices are never copied into an article: Chat reads them from the plan facts.
- `updated` / `last_checked`: when it last changed, and when it was last checked against the app; `app_version` the version it was checked against.
- `approved`: `false` until the owner approves it.
- `sources`: the documentation it was written from.

## Body

- A one-paragraph intro, then `##` sections. Every section, the intro included, is 150 words or fewer, so it can be answered from alone.
- Plain English, as the app says it: name pages, tabs and buttons by their labels (**Tracked Prompts**, **Add prompt**), never by their addresses.
- No code, links, HTML, internal names, database or API details (CHAT-19 §3). Chat adds the page card from `route`.
- Only what the app does today. When a feature changes, its article changes in the same pull request ("Help article updated").

`web/src/lib/help/validate.test.ts` checks every article against these rules.
