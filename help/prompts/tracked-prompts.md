---
title: Tracked Prompts list, statuses and columns
route: /dashboard/prompts/tracked
keywords: [tracked prompts, prompt status, columns, performance filter, paused prompts]
synonyms: [prompt list, my prompts, prompt table, tracked queries]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/prompts.mdx]
---
**Tracked Prompts** lists every prompt Ansvisor asks the AI engines for your brand, with its results over the date range you pick (24h, 7d, 30d, 90d or custom). It sits on the **Prompts** tab of the **Prompts** page: a switch above the filters picks **Tracked Prompts** or **Prompt Suggestions**. The date range carries over when you switch to Topics or Query Fan-out.

## Prompt statuses

Each row has a status:

- **New** (amber): added in the last 24 hours. New prompts lead the table until you sort by a column; after a day they read as Active.
- **Active**: tracked on its schedule.
- **Paused**: kept, but not tracked.

The table opens on **Active + New**. The **Status** filter, or the cards above the table, show one status or all of them.

## Rows without figures

A new prompt has no results until it's first asked. Until then, for its first two days, the row says **Within 24h** in its first figure column, such as Visibility. A paused prompt says **Paused** there when the Status column is hidden. An older prompt with no results in the range, such as days without a run, shows a dash, as does a range that ended before today.

## Choose your columns

**Columns**, beside the search box, picks the table's columns: tick one to show or hide it, and drag it, or use its arrows, to move it. **Prompt** always shows. The **Added** column shows when each prompt was added; click it to sort by it. The **Volume** column shows each prompt's estimated AI search volume.

Your columns are saved for you on this brand; nobody else's table changes.

## Share a column view with the brand

Admins and managers can tick **Share with everyone on** the brand: their columns become the brand's view, which everyone without columns of their own sees. Anyone can still change their own. **Reset to the brand's view** goes back to the brand's columns, and **Reset to default** to the default columns when the brand has none.

## Filter by performance

The **Performance** filter groups prompts by where your brand is named in their AI answers over the selected range, across every platform the prompt tracks:

- **Best**: named in the first third of the brands an answer lists.
- **Good**: named in the middle third.
- **Late**: named in the last third.
- **Missing**: named in fewer than half the answers.

Late and Missing list the furthest behind first. A prompt with no answers in the range, such as a new one, has no performance yet. The dots in the **Positions** column show each platform on its own.

## Open a prompt or act on it

Click a prompt's text to open its own page, with its visibility, mentions, citations and per-platform results. Each row's **…** menu offers **Edit**, **Pause tracking**, **Improve position…**, **Suggest content**, **Create content** and **Delete**.

**Export CSV** downloads the list. Estimated volumes in it are marked as estimates, with their confidence and range, so a spreadsheet doesn't read them as counts.
