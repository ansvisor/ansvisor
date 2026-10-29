---
title: Find content opportunities
route: /dashboard/content
keywords: [content opportunities, opportunity score, impact, visibility gap, content ideas]
synonyms: [content optimization, content gaps, what to write, content suggestions]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/content-optimization.mdx, docs/guides/content-editor.mdx, server/src/lib/opportunity-generator.js, server/src/lib/opportunity-dedup.js, server/src/lib/opportunity-limits.js]
---
The **Opportunities** page, under **Content** in the sidebar, lists content opportunities: prompts where competitors are more visible than you in AI answers. Each one suggests a piece of content that could close the gap, and you can start writing it, plan it or send it on from there.

## What an opportunity shows

Each opportunity has a title, the angle of the content to write, and an **Impact** of **High**, **Medium** or **Low**, which Ansvisor rates when it writes the opportunity. It also has an opportunity score from 0 to 100.

Open an opportunity to see its **Source Data**: the **Related Prompt**, **Est. AI Volume**, **Current Visibility**, **Competitor Gap**, **Search Intent**, **Keywords** and **Competitors Cited**.

## Act on an opportunity

- **Send to Editor** starts a page from the opportunity in the Content Editor.
- **Send to Plan** (admins and managers) puts it at the top of the Content plan's priority list.
- **Generate Brief** (admins and managers) writes a content brief for it: a title, an outline, keywords and more.
- **Send to Workflow**, in the opportunity's **…** menu, sends it and its brief to your workflow tool. Its status becomes **Sent to Workflow**.

## Work on many at once

On the list, tick several opportunities. **Send All** sends them all to your workflow, which suits kicking off a content sprint. Admins and managers also see **Dismiss All**, which sets a batch aside when it isn't relevant this quarter, and **Done**, which marks the ones your team has published.

## Ask for new opportunities

Admins and managers click **New** to get suggestions now, instead of waiting for the next automatic run. Pick a **Focus**: **Let Ansvisor choose**, a **Topic** or a **Prompt**. You can add your own idea, up to 500 characters, and set **How many**.

Opportunities are written per group of prompts: prompts of one topic that a single page could answer, and that already have tracked answers. Each group has at most one open opportunity.

## What each focus picks

- **Let Ansvisor choose** takes the highest-scoring groups that have no opportunity yet, one from each topic first.
- **Topic** takes only that topic's groups.
- **Prompt** takes only that prompt's group, so it always writes one opportunity, and **How many** stays at 1. If that prompt already has an open opportunity, a message says so when the run ends, with **Open existing**.

## No duplicates

Ansvisor never writes the same work twice. When a new opportunity would cover the same need as one you have, because their prompts and AI searches largely overlap, it's added to that one instead and skipped. If nothing new is left, a message says every matching need already has one.

For a second take on the same need, use **Another angle** on the opportunity.

## How many you get

New opportunities come from a monthly allowance set by your plan, with a cap on how many one request asks for; on limited plans the page shows what's left. Skipped duplicates and opportunities that couldn't be written don't count; **Another angle** counts as one new opportunity. Ansvisor also writes up to three new opportunities by itself each night.

## Owned and earned

Each opportunity has a **Type**. **Owned** means content on your own site. **Earned** means coverage on other sites, such as articles, reviews and links. Some gaps are best closed with a guest post or a press placement rather than a new page of your own.

## Pick what to work on

Don't ship every brief. Editorial time is usually the bottleneck, so pick the two to four high-impact opportunities a week your team can really write, and leave the rest for later.
