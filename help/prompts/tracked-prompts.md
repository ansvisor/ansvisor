---
title: Tracked Prompts list, statuses and columns
route: /dashboard/prompts/tracked
keywords: [tracked prompts, prompt status, columns, performance filter, paused prompts, waiting for a spot, free up a spot, prompt tags, tag filter, bulk tags]
synonyms: [prompt list, my prompts, prompt table, tracked queries]
plan: all
updated: 2026-11-14
last_checked: 2026-11-14
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
**Tracked Prompts** lists every prompt Ansvisor asks the AI engines for your brand, with its results over the date range you pick (24h, 7d, 30d, 90d or custom). It sits on the **Prompts** tab of the **Prompts** page: a switch above the filters picks **Tracked Prompts** or **Prompt Suggestions**. A range you pick carries over to Topics and Query Fan-out.

## Prompt statuses

Each row has a status:

- **New** (amber): added in the last 24 hours. New prompts lead the table until you sort by a column; after a day they read as Active.
- **Active**: tracked on its schedule.
- **Paused**: kept, but not tracked.
- **Waiting for a spot**: saved past your plan's limit, not tracked and not counted. It never starts by itself.

While prompts wait, a yellow banner above the table says how many; admins and managers get **Free up a spot**, which lists prompts you could pause, least useful first, and **Pause it and track this one**. The table opens on **Active + New**. The **Status** filter, or the cards under **Plan & usage** (click **Show**), show one status or all of them.

## Rows without figures

A new prompt has no results until it's first asked. Until then, for its first two days, the row says **Within 24h** in its first figure column, such as Visibility. While a new brand's first tracking runs, it says **Arriving now** instead: that tracking is asking it. A paused prompt says **Paused** there when the Status column is hidden. An older prompt with no results in the range, such as days without a run, shows a dash, as does a range that ended before today.

## Choose your columns

**Columns**, beside the search box, picks the table's columns: tick one to show or hide it, and drag it, or use its arrows, to move it. **Prompt** always shows. The **Added** column shows when each prompt was added; click it to sort by it. The **Volume** column shows each prompt's estimated AI search volume. The **Work** column, with its filter, shows your content work on each prompt: **To do**, **In progress**, **Done** or no status.

Your columns are saved for you on this brand. Admins and managers can tick **Share with everyone on** the brand to make theirs the brand's view; everyone can still change their own, or go back with **Reset to the brand's view**.

## Share a column view with the brand

Admins and managers can tick **Share with everyone on** the brand: their columns become the brand's view, which everyone without columns of their own sees. Anyone can still change their own. **Reset to the brand's view** goes back to the brand's columns, and **Reset to default** to the default columns when the brand has none.

## Filter by performance

The **Performance** filter groups prompts by where your brand is named in their AI answers over the selected range, across every platform the prompt tracks:

- **Best**: named in the first third of the brands an answer lists.
- **Good**: named in the middle third.
- **Late**: named in the last third.
- **Missing**: named in fewer than half the answers.

Late and Missing list the furthest behind first. A prompt with no answers in the range, such as a new one, has no performance yet. The **Positions** column shows your average position and its change; hover it for each platform, or use its chart button to open the positions panel.

## Organize with tags

Tags label prompts with your own words, such as a campaign or a product line. A prompt can carry up to 10 tags, each up to 50 characters. Admins and managers tag a prompt from **Edit** on its **…** menu, under **Tags**: type one and press Enter. A prompt's tags show beside its text in the table.

To tag many prompts at once, tick their rows and open **Tags** in the bar that appears: **Add tags** puts tags on every selected prompt, leaving one that would go over 10 tags alone, and **Remove tags** takes the tags you pick off them. The dialog says how many prompts will change before you save.

The **Tags** filter, beside the search box, narrows the table to one or more tags. With several picked, **Match all** keeps the prompts carrying every one; **Match any** keeps those carrying at least one. It combines with the search box and the other filters.

## Open a prompt or act on it

Click a prompt's text to open its own page, with its visibility, mentions, citations and per-platform results. For admins and managers, each row's **…** menu offers **Edit**, **Pause tracking** (or **Resume tracking**), **Improve position…**, **Suggest content** (or **Open content suggestion**), **Create content** (or **Open draft**) and **Delete**.

**Export CSV** downloads the list. Estimated volumes in it are marked as estimates, with their confidence and range, so a spreadsheet doesn't read them as counts.
