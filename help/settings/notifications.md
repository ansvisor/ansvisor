---
title: Choose your e-mails
route: /dashboard/settings/notifications
keywords: [notifications, e-mails, email preferences, daily pulse, weekly digest, unsubscribe]
synonyms: [stop the emails, too many emails, email settings, notification settings, who gets the pulse]
plan: all
updated: 2026-11-20
last_checked: 2026-11-20
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/daily-pulse.mdx, docs/guides/ai-traffic-analytics.mdx]
---
**Settings › Notifications** is one place for every e-mail Ansvisor sends you. Under **Your e-mails**, you pick which e-mails you get and how often. These choices are yours only: everyone on the team sets their own, and changing yours never changes a teammate's.

## Pick your e-mails

The e-mails are grouped: **Brand Visibility** (the Daily Pulse), **AI Traffic** (the weekly digest), **Action Center**, **Agents and Chat**, **Site Audit**, **Content** and, for Admins, **Account**. Each has its own choices, such as **Right away**, **Daily summary**, **Weekly** or **Off**. Press **Save changes** to keep them. **Turn off all optional e-mails** sets every e-mail that can be turned off to **Off**; save to keep it.

Until you save for the first time, the page shows the e-mails you get today, so nothing changes by itself.

**Billing and security** e-mails are always sent.

## Critical actions and drafts in review

**A new Critical action** tells you when an Action Center action reaches Critical priority: **Right away**, one e-mail per action within about ten minutes, or **Daily summary**, one e-mail a day per brand with the day's new ones. It names the action by its code, such as AC-12, and links to it. It's **Off** until you pick it.

**Drafts waiting for your review** lists a brand's Content drafts in review, up to ten, with a link to **Library › In review**. It comes as a **Daily summary**, or on Mondays with **Weekly summary**, the choice everyone starts with. Nothing comes when no draft waits.

Each e-mail comes once, only for brands you can open.

## Due actions and the weekly summary

**Overdue and due today** lists the open actions assigned to you whose due date is today or past, with how many days late each is, one e-mail per brand. It comes as a **Daily summary**, or on Mondays with **Weekly summary**, the choice everyone starts with. Nothing comes when nothing is due.

**Weekly action summary** comes on Mondays, one per brand: how many actions were completed in the last seven days, how many are open, and the next three by priority. Everyone starts with it on; set it to **Off** to stop it.

## Audit finished and Score dropped

**Audit finished** tells you when audits finish, a bulk run's or a scheduled run's, with each page's score. **Right away** gathers the audits finished in the last few minutes in one e-mail per brand, so a bulk run isn't one e-mail per page; **Daily summary** sends the day's.

**Score dropped** tells you when a page's new audit scores 5 points or more below its previous one, such as 70 → 61, **Right away** or in the day's summary. A page's first audit is never a drop.

Both are **Off** until you pick them, and each audit is told once. With **Audit finished** on for a brand, its scheduled runs no longer also send the workspace's auto-audit e-mail to you: you get one.

## Run finished and AI usage

**Run finished** tells you when an agent's run that acted for you ends, finished, failed or stopped, with the agent's name and a link to the run's chat: **Right away**, gathering the runs that ended in the last few minutes per brand, or in a **Daily summary**. It's **Off** until you pick it.

**AI usage**, for Admins, tells you when the workspace has used 80% of its monthly AI limit, then 100%, once each a month, with a link to **Billing**. It's on until you turn it off; plans without a limit never get it.

## Set a brand apart

With more than one brand, **For** picks what your choices apply to. **All my brands** sets them for every brand you can open. Pick one brand to set it differently: the row then says it's set for that brand only, and **Use my All my brands choice** puts it back. Brand e-mails come one per brand; one e-mail for all brands is coming soon.

## Approvals and scheduled jobs

**Waiting for your approval** is set in Chat's settings, with **Notify me when an agent needs me**: the row links there. **Scheduled jobs** e-mail as each job is set; **Open jobs** takes you to them.

## Send to people outside the workspace

Admins can send a brand's Daily Pulse and AI Traffic weekly digest to people without an Ansvisor seat, such as a client. Under **Send to people outside the workspace**, each brand has a list of addresses, separated by commas, how often its Daily Pulse comes, and a tick box for the weekly digest. Press **Save changes** under the brand. An address that isn't valid is listed under the field, and nothing is saved until you fix it. People outside the workspace never get approvals or account e-mails.

## Teammates who haven't chosen yet

A teammate who hasn't saved their own choices gets a brand's e-mails as before: every teammate while the brand's list is empty, else only those on it, at the frequency set there. The same frequency sets the brand's Slack channel and webhooks.
