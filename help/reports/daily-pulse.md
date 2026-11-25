---
title: Daily Pulse email digest
route: /dashboard/settings/notifications
keywords: [daily pulse, digest, notifications, email summary, highlights, warnings]
synonyms: [daily email, weekly email, brand digest, visibility alerts, stop the emails]
plan: all
updated: 2026-11-20
last_checked: 2026-11-20
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/daily-pulse.mdx]
---
The Daily Pulse is a short digest for each brand that goes out after its scheduled tracking run. It shows the headline numbers for the period, then lists what went well (highlights) and what needs attention (warnings). It comes by email on Ansvisor Cloud, and can also go to your webhook and to the brand's Slack channel (set in **Settings › Integrations**), on cloud and self-hosted alike.

## Choose how often it comes

Open **Settings › Notifications**. Under **Your e-mails**, **Daily Pulse** is in the **Brand Visibility** group: pick how often it comes to you, for all your brands or one brand apart, and press **Save changes**. Each teammate picks their own. The **Manage notification settings** link at the bottom of every pulse email opens this page.

- **Daily**: after every scheduled daily tracking run.
- **Weekly**: once a week on Monday (UTC), covering the last 7 days compared with the 7 days before.
- **Only when notable** (the default): your first pulse always goes out, so you see your starting point. After that it is like Daily, but skipped when there are no highlights and no warnings.
- **Off**: you get no pulse email.

## Choose who else gets it

Admins can add people outside the workspace, such as a client, under **Send to people outside the workspace**: each brand has a list of addresses, separated by commas, and how often its pulse comes. Each address is checked when you save; invalid ones are listed under the field. Up to 50 addresses are stored. A teammate who hasn't saved their own choices gets the pulse as before: every teammate while the list is empty, else only those on it. The brand's frequency there also sets its webhook and Slack post; **Off** stops both.

## AI Traffic weekly digest

The **AI Traffic weekly digest** comes every Monday: last week's AI visits in one summary line, with the top three changes. Pick **Every Monday** or **Off** for it under **Your e-mails**, in the **AI Traffic** group. For people outside the workspace, an Admin ticks or unticks it under the brand; it isn't sent to them while the brand's Daily Pulse is **Off**.

## When it is sent

A pulse follows a brand's scheduled daily tracking run; manual runs and single-prompt refreshes never trigger one. It waits up to 90 minutes for late answers, so its numbers match the dashboard. Nobody gets a pulse whose frequency is **Off**, or **Weekly** when it isn't Monday. No pulse is sent when the brand already had one that day; when there are no tracking results in the window; when the frequency is **Only when notable**, it isn't the brand's first pulse and nothing is notable; or, on the cloud, when the subscription isn't active or trialing.

## What's in a pulse

The KPIs are the **Visibility score** (out of 100, not a percentage), the **7-day average** score with its change in points from the 7 days before, **Mentions** and **Citations**, **Positive sentiment**, and **Prompts with a mention**, such as "135 of 227": 227 is the number of prompts with answers in the period. For Daily and Only when notable, the period is the latest completed tracking run, at most 24 hours, compared with the run before it. For Weekly, it is the last 7 days compared with the 7 days before. Lines that cover another period name it. The email subject carries the visibility score and the 7-day average; on Weekly, it says Weekly Pulse.

## Highlights

- **First citation**: a URL from a prompt's Target URLs list was cited by an AI engine for the first time. Up to 5 are listed.
- **Prompt gain**: a prompt's visibility score rose by 5 points or more in the last 7 days versus the 7 days before. The top 3 are listed.
- **Competitor overtaken**: in the 7 days before, a competitor's score was at or above yours; in the last 7 days yours is higher.
- **New engine**: your brand was mentioned or cited on an AI platform for the first time ever.

## Warnings

- **Sharp drop**: your visibility score fell week over week by at least 3 points and at least 30% of last week's score, for brands with 10 or more tracked prompts.
- **Competitor surge**: a competitor's score rose by 15 points or more week over week.
- **Competitor crossed**: a competitor at or below your score last week is above it this week.
- **Lost citations**: a prompt with an estimated AI volume above zero was cited on at least 60% of its result days in the last 14 days, then not at all on its 3 most recent.

A smaller fall shows as **Visibility slipping**, in the email and the webhook alike.

## Repeats and collection problems

The same warning about the same subject, such as a surge by the same competitor, isn't repeated within 7 days. Highlights have no such pause. If an AI platform's result volume collapses on Ansvisor's side, the pulse treats it as a collection problem rather than a real change: **Sharp drop**, **Visibility slipping** and **Lost citations** are held back, and the email notes which platforms were affected.

## Send it to a webhook

Every pulse also goes to the brand's active webhook, if it is subscribed to the Daily Pulse event: under **Content**, open **Webhook Settings** and tick **Daily Pulse created**. On self-hosted installs, this is the only way the pulse is delivered. The webhook carries the same KPIs, highlights and warnings as the email. The brand's frequency under **Send to people outside the workspace** applies to it too; the recipient list and people's own choices don't.
