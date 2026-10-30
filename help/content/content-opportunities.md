---
title: Find content opportunities
route: /dashboard/content
keywords: [content opportunities, opportunity score, impact, visibility gap, content ideas, export csv, filter opportunities, bulk actions]
synonyms: [content optimization, content gaps, what to write, content suggestions]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/content-optimization.mdx, docs/guides/content-editor.mdx, server/src/lib/opportunity-generator.js, server/src/lib/opportunity-dedup.js, server/src/lib/opportunity-limits.js]
---
The **Opportunities** page, under **Content** in the sidebar, lists content opportunities: what to write or change so AI answers name you where they don't yet. Ansvisor suggests them on its own as tracking data comes in. An opportunity is built for a group of related prompts that one piece of content can answer, or for a single prompt. From each one you can start writing, plan it, brief it or send it on.

## What each row shows

- the action to take, with what it was built for: a topic and its number of prompts, **Single prompt**, or the Action Center action it came from;
- when it was **Suggested**, with a dot on the rows suggested since your last visit;
- its **Type**: **Owned** or **Earned**, and, where it applies, what to do with your page: Create, Optimize, Expand, Refresh, Consolidate or Defend;
- its **Impact**, **High**, **Medium** or **Low**, which Ansvisor rates when it writes the opportunity, and its **Score**, from 0 to 100;
- its **Status**: New, Reviewed, Sent to Workflow, In Progress, Done, Dismissed or Archived.

Above the list, cards count the **Total Opportunities** and the **High Impact** ones, and give the **Avg. Score**. On plans with monthly limits, **This billing period** shows how many new opportunities and content briefs are left, and when they reset.

## Filter, sort and export

- Search the opportunities, and narrow the list by topic, prompt, type, impact, **Source** and status. The sources are **System**, suggested automatically; **Manual**, made with **New**; **Prompt**, suggested from a prompt; and **Action**, sent from an Action Center task.
- **Suggested** picks a period, all time, this month, the last 30 days or your own dates, and the order: highest score, newest or oldest.
- Archived opportunities stay hidden unless you filter to them.
- The filters stay in the page's address, so a link opens the same view.
- **Export CSV** downloads every opportunity that matches the filters and the search, not only the page you see.

## Quick actions on a row

Each row's **…** menu has the quick actions:

- **Send to Editor**, or **Open draft** once a draft is being written for it;
- **Send to Plan**;
- **Send to Workflow**, for a new opportunity;
- **Open in new tab**, which opens it as a page of its own;
- **Dismiss**, for a new one. Undo it from the message that appears.

Send to Plan and Dismiss are for admins and managers. Click an opportunity's title to open it in a panel beside the list, with all its data and the rest of its actions.

## Work on many at once

Tick rows, or the box in the header for every row shown, then:

- **Send All** sends each one to your workflow tool, which suits kicking off a content sprint.
- **Done**, **Dismiss All** and **Delete** change them all at once. They're for admins and managers.

**Delete** removes the opportunities for good, with any brief they have, and doesn't give back the month's opportunities or briefs. Dismissing keeps them out of your way instead.

## Ask for new opportunities

Admins and managers click **New** to get suggestions now, instead of waiting for the next automatic run. Pick a **Focus**: **Let Ansvisor choose**, a **Topic** or a **Prompt**. You can add your own idea, up to 500 characters, and set **How many**.

Opportunities are written per group of prompts: prompts of one topic that a single page could answer, and that already have tracked answers. Each group gets one opportunity; only **Another angle** adds a second take on it.

## What each focus picks

- **Let Ansvisor choose** takes the highest-scoring groups that have no opportunity yet, one from each topic first.
- **Topic** takes only that topic's groups.
- **Prompt** takes only that prompt's group, so it writes at most one opportunity, and **How many** stays at 1. If that prompt already has an open opportunity, a message says so when the run ends, with **Open existing**.

## No duplicates

Ansvisor never writes the same work twice. When a new opportunity would cover the same need as one you have, because their prompts and AI searches largely overlap, it's added to that one instead and skipped. If nothing new is written, the message says so and counts any duplicates it skipped.

For a second take on the same need, use **Another angle** on the opportunity.

## How many you get

New opportunities come from a monthly allowance set by your plan, with a cap on how many one request asks for; on limited plans the page shows what's left. Skipped duplicates and opportunities that couldn't be written don't count; **Another angle** counts as one new opportunity. The up to three new opportunities Ansvisor writes by itself each night come from the same allowance.

## Owned and earned

Each opportunity has a **Type**. **Owned** means content on your own site. **Earned** means coverage on other sites, such as articles, reviews and links. Some gaps are best closed with a guest post or a press placement rather than a new page of your own.

Earned opportunities don't go to the Content Editor: send them to the Action Center or your workflow tool.

## Pick what to work on

Don't ship every brief. Editorial time is usually the bottleneck, so pick the two to four high-impact opportunities a week your team can really write, and leave the rest for later.
