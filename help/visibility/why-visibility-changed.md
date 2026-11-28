---
title: Find out why your visibility changed
route: /dashboard/insights
keywords: [why it changed, visibility breakdown, see answers, answers tab, full breakdown, gains, drops, visibility drop, root cause]
synonyms: [why did my score drop, why did visibility go up, what moved my score, investigate a drop, score change explained]
plan: all
updated: 2026-11-28
last_checked: 2026-11-28
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/answer-engine-insights.mdx, docs/concepts/visibility-scoring.mdx]
---
When your Visibility goes up or down on the **Visibility** page, two parts of the page explain it: the **Why it changed** card and the **Visibility Breakdown** panel. Both compare the date range you picked with the period of the same length just before it.

## How a change is measured

Every change compares the selected range with the period of the same length just before it, **vs previous period**, over only the prompts answered in both periods. Adding prompts doesn't inflate it.

Visibility changes are in points; Mentions and Citations change in percent. With **All** selected there is no earlier period, so no change is shown. A rate based on fewer than 20 answers says **Low sample** and shows no change.

## The Why it changed card

**Why it changed** lists the platforms, topics and prompts that moved your Visibility most, under **Gains** and **Drops**. Each row shows its own score before and after, and its effect on your overall score. With **All** selected, the card doesn't show. When either period has fewer than 20 answers, it says there are too few answers to explain the change.

A note counts the prompts added during the period: they aren't counted in the change. Click a row, or **Full breakdown**, to open the **Visibility Breakdown** panel.

## The Visibility Breakdown panel

The **Visibility** card, a row of **Why it changed** and **Full breakdown** all open the **Visibility Breakdown** panel. It compares the selected range with the period of the same length just before it, and names the prompt and platform behind the biggest gain or drop.

It lists every slice under three tabs: **Prompts**, **Platforms** and **Topics**. Click a prompt to open its page, where **Platform Results** shows each AI answer and the sources it cited.

## The Answers tab

A fourth tab, **Answers**, lists the answers behind the number, for the same range and filters, newest first, 25 a page. Each shows its prompt, platform, location and date, whether it names you (and in which place), a short excerpt and how many sources it cited, yours among them. **Open full answer** shows the whole answer. A run that saved no answer text says **No answer text**, never **Not mentioned**. **See answers** under the **Visibility** and **Mentions** cards opens this tab; for Mentions it lists the answers that name you.

## Investigate a sharp drop

1. Click the **Visibility** card, or the dropped row in **Why it changed**. The panel names the prompt and platform behind the biggest drop.
2. Click the prompt to open its page and read the answers under **Platform Results**. Is your brand still mentioned but named later, or completely absent?
3. Check the competition: the **Leaderboard** and **Topics vs competitors** show who leads where. A competitor surge is often the cause; **Head-to-Head** opens the Competitors page for a closer look.
4. Check the sources each answer cited; the **Citations** card opens the **Citations** tab. A retracted article or a new competitor post is often the trigger.

## Decide what to do

Once you know what moved the score, pick one of three:

- publish content aimed at the prompt;
- earn a placement on a site AI engines cite;
- accept it as a one-time dip.

A score may also dip after you add new prompts, until those prompts mature.
