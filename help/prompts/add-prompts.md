---
title: Add prompts to track
route: /dashboard/prompts/tracked
keywords: [add prompt, bulk import, track prompts, new prompt]
synonyms: [add a question, add queries, track a search]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/prompts.mdx]
---
A prompt is a question Ansvisor asks the AI engines for your brand every day, such as "best project management tool for agencies". Its answers show where your brand is named and cited. You can add prompts one at a time, many at once, or from suggestions.

## Add one prompt

On **Prompts › Tracked Prompts**, click **Add prompt**. On the **Single** tab, type the question and pick its topic, platforms and AI models, then save. It is tracked in the brand's location; add more later with **Track in more locations**.

## Add many at once

In the same dialog, open the **Bulk import** tab and upload a one-column Excel or CSV file of prompts. A preview marks each row as ready, a duplicate, an error or over your plan limit, and the rows that fit are imported. Set their topic and location afterwards from each prompt's **Edit**.

## Add from suggestions

Switch the list to **Prompt Suggestions**. Add one suggestion with its **+** button, or every listed one with **Add All**.

## When the first results come

A prompt has no results until it is first asked. **Add prompt** and **Bulk import** start right away when they can. A prompt added from suggestions, or one whose analysis couldn't start, gets its first results with the next daily run. Until then, for its first two days, its row says **Within 24h**.

## What counts on your plan

Every prompt counts on your plan's prompt limit, once in each location it is tracked in. Paused prompts don't count. If adding would pass the limit, Ansvisor adds the prompts that fit and says how many weren't added. Once the limit is reached, it adds nothing until you pause or remove prompts.
