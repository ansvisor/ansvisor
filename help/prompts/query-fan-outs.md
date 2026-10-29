---
title: Query Fan-outs behind AI answers
route: /dashboard/prompts/fan-outs
keywords: [query fan-out, fan-outs, searches behind answers, copilot, perplexity]
synonyms: [sub-queries, background searches, AI search queries, what the AI searched]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/prompts.mdx]
---
Behind an answer, an AI engine can run searches of its own. The **Query Fan-out** tab of the **Prompts** page lists the searches the AI engines ran behind their answers to your tracked prompts. In the sidebar, the **Prompts** item opens it as **Query Fan-outs**.

## Which engines share their searches

Only Copilot and Perplexity share the searches behind their answers. Answers from the other engines come without them, so those engines can't appear on this tab.

## Pick the date range

The tab uses the **Prompts** page's date range: 24h, 7d, 30d, 90d or custom. The range applies to Prompts, Topics and Query Fan-out alike, and carries over when you switch between these tabs.
