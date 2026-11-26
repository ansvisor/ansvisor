---
title: See what Ansvisor did for you
route: /dashboard/reports/impact
keywords: [what ansvisor did for you, impact, shipped changes, results, improved, pending, not measurable, checkpoints, control prompts, export csv]
synonyms: [did it work, results of my changes, impact report, proof of results, what changed after publishing]
plan: all
updated: 2026-11-21
last_checked: 2026-11-01
owner: Cihan
app_version: 0.3.0
approved: true
sources: [web/messages/en.json, web/src/components/reports/impact-report.tsx, web/src/lib/actions/impact-report.ts]
---
**What Ansvisor did for you** lists the changes you shipped in a month, such as a page published to your CMS, and what each one did in AI answers. Open it from **Reports** with **What Ansvisor did for you**, and go back with **Back to Reports**. It shows the brand you have open.

The button appears once the brand has shipped its first change: a page your CMS confirmed after **Send to CMS**, or an agent's first go-live. Until then the page says it fills in after that first change.

## What shipped means

A change is shipped once it went live: published to your CMS, its pull request merged, or marked as shipped. A draft waiting for review isn't shipped yet, so it isn't measured. A month with nothing shipped says so and points to **Today's focus**, where you can start an action.

## How a change is measured

The page sums this up under **How we measure**. Each change is compared on its target prompts: the 14 days before it shipped against the days after. The same is done for similar prompts nothing touched, the control. The **Lift** is how much more the target prompts moved than the control, in points. A change needs a lift of at least 3 points to count as **Improved** or **Declined**.

Results come at **checkpoints**: day 7 shows only the early direction (**Pending · early signal**), day 14 gives the first verdict, day 30 confirms it and day 90 shows whether it lasted. In a change's details, day 90 says **Held** when it kept the verdict before it, or **Faded** when it didn't. It all comes from your scheduled tracking, so it costs nothing extra.

A result shows that things moved together, not that the change alone made them move.

## Read the page

The cards count the changes shipped this month, and **Improved** out of the changes with a verdict of Medium or High confidence. Low confidence and **Not measurable** changes are listed in the table but not counted. **AI traffic to changed pages** compares the AI visits those pages had this month and last month, from Google Analytics.

Percentages and lifts are shown to one decimal. Filter the table by outcome, and click a change to see its windows, numbers, other changes on the same prompts and each checkpoint. A change is **Not measurable** when, for example, too few similar prompts exist to compare.

A month with more than 500 changes lists its first 500, and says so; the cards count only those.

## Export

Click **Export** and **Download CSV** to save the month's changes and results, with the same numbers and days the table shows.
