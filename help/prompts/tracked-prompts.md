---
title: Tracked Prompts list, statuses and columns
route: /dashboard/prompts/tracked
keywords: [tracked prompts, prompt status, columns, performance filter, paused prompts, waiting for a spot, free up a spot, prompt tags, tag filter, bulk tags, export csv, manage prompts, plan and usage, location filter, analyze volume, track now, no answers yet]
synonyms: [prompt list, my prompts, prompt table, tracked queries]
plan: all
updated: 2026-11-17
last_checked: 2026-11-17
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
**Tracked Prompts** lists every prompt Ansvisor asks the AI engines for your brand, with its results over the date range you pick (24h, 7d, 30d, 90d or custom). It sits on the **Prompts** tab of the **Prompts** page: the **Tracked** | **Suggestions** switch, at the left of the date range, picks this list or **Prompt Suggestions**. A range you pick carries over to Topics and Query Fan-out.

## Where the page's actions are

You manage the brand's prompts on this page. Beside the tabs, admins and managers have **Add prompt**. The rest is in the **…** menu (More actions) next to it:

- **Export CSV** downloads the list.
- **Plan & usage** opens your plan and billing.
- **Show usage** opens cards with this brand's active and total prompts, and your account's prompt locations and slots left. Click a brand card to filter the table; **Hide** folds them away. When your prompt locations are nearly or fully used, a line under the filters says so, with **Plan & usage**, and the menu says so under **Show usage**.

The **Location** filter, for a brand tracked in more than one place, sits in the table's filter row, beside **Status** and **Work**.

## Prompt statuses

Each row has a status:

- **New** (amber): added in the last 24 hours. New prompts lead the table until you sort by a column; after a day they read as Active.
- **Active**: tracked on its schedule.
- **Paused**: kept, but not tracked.
- **Waiting for a spot**: saved past your plan's limit, not tracked and not counted. It never starts by itself.

While prompts wait, a yellow banner above the table says how many; admins and managers get **Free up a spot**, which lists prompts you could pause, least useful first, and **Pause it and track this one**. The table opens on **Active + New**. The **Status** filter, or the usage cards (**…** › **Show usage**), show one status or all of them.

## Track new prompts now

A prompt gets its first answers with the next tracking run. When some active prompts have no answers yet, a line under the filters says how many, with **Track now**: admins and managers click it to have the AI engines asked now. To track only some, tick their rows and click **Track now** in the bar that appears; it counts only the selected prompts with no answers yet.

The line then says **Tracking N prompts now**, and **See answers** opens **Visibility**, which shows the run as it goes. Answers arrive over the next minutes. Your plan sets how many runs you can start a day, and how long to wait between them; the message says so when you've reached either.

## Rows without figures

When some active prompts have no volume yet, a line under the filters says **Volume and competition missing for N prompts**. Those prompts are tracked as usual, with their visibility, mentions, citations and positions; only these two columns wait for a volume check. Admins and managers click **Analyze** to run it.

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

Tags label prompts with your own words, such as a campaign or product line. A prompt carries up to 10 tags, each up to 50 characters. Admins and managers tag one from **Edit** on its **…** menu, under **Tags**: type and press Enter. Tags show beside the prompt's text in the table.

To tag many at once, tick their rows and open **Tags** in the bar that appears: **Add tags** puts them on every selected prompt, leaving one that would go over 10 alone, and **Remove tags** takes the picked tags off. The dialog says how many prompts will change before you save.

The **Tags** filter beside the search box narrows the table to one or more tags. With several picked, **Match all** keeps prompts carrying every one; **Match any** keeps those carrying at least one. It combines with search and the other filters.

## Open a prompt or act on it

Click a prompt's text to open its own page, with its visibility, mentions, citations and per-platform results. For admins and managers, each row's **…** menu offers **Edit**, **Pause tracking** (or **Resume tracking**), **Improve position…**, **Suggest content** (or **Open content suggestion**), **Create content** (or **Open draft**) and **Delete**.

When an Improve action sent for a prompt is still being tracked, its **Work** cell shows a link with the action's code, such as **AC-12 · Improving**. It opens the prompt's positions panel on its **Improve** tab.

**Export CSV** downloads the list. Estimated volumes in it are marked as estimates, with their confidence and range, so a spreadsheet doesn't read them as counts.
