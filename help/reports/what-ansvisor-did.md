---
title: See what Ansvisor did for you
route: /dashboard/reports/impact
keywords: [what ansvisor did for you, impact, shipped changes, results, improved, pending, not measurable, checkpoints, control prompts, export csv]
synonyms: [did it work, results of my changes, impact report, proof of results, what changed after publishing]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/components/reports/impact-report.tsx]
---
**What Ansvisor did for you** lists the changes you shipped in a month, such as a page published to your CMS, and what each one did in AI answers. Open it from **Reports** with **What Ansvisor did for you**. It shows the brand you have open.

## How a change is measured

Each change is compared on its target prompts: the 14 days before it shipped against the days after. The same is done for similar prompts nothing touched, the control. The **Lift** is how much more the target prompts moved than the control, in points. A change needs a lift of at least 3 points to count as **Improved** or **Declined**.

Results come at **checkpoints**: day 7 shows only the early direction (**Pending · early signal**), day 14 gives the first verdict, day 30 confirms it and day 90 shows whether it lasted. It all comes from your scheduled tracking, so it costs nothing extra.

A result shows that things moved together, not that the change alone made them move.

## Read the page

The cards count the changes shipped this month, and **Improved** out of the changes with a verdict of Medium or High confidence. Low confidence and **Not measurable** changes are listed in the table but not counted. **AI traffic to changed pages** compares the AI visits those pages had this month and last month, from Google Analytics.

Filter the table by outcome, and click a change to see its windows, numbers, other changes on the same prompts and each checkpoint. A change is **Not measurable** when, for example, too few similar prompts exist to compare.

## Export

Click **Export** and **Download CSV** to save the month's changes and results.
