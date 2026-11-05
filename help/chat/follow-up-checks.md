---
title: Follow-up checks in Chat
route: /dashboard/chat
keywords: [follow-up check, set check, check later, re-check citations, did it work, after a change, impact]
synonyms: [check back, remind me to check, measure a change, follow up on a fix]
plan: all
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, help/chat/scheduling.md]
---
A follow-up check looks again at something you changed, on a later day, and tells you what happened. Chat offers one after a change you made or approved, such as a refreshed page or a fix. It can check tracked prompts, or a page or an Action Center action once its change is shipped (published or marked as shipped).

## Set a check

In **Ask me first** and **Auto**, Chat shows a small card: the check's name and when it runs, such as in 7, 14, 30 or 90 days. Click **Set check**, or **Not now** to skip it. Nothing is set until you click.

In **Full auto**, Chat sets the check by itself. The steps above the answer say **Follow-up check set**, and the change is in the **Activity log** with **Undo** until the check runs.

A run sets at most 3 checks. Only Admins and Managers can set them, and they don't count toward your plan's scheduled jobs.

## What a check reads

A check reads your scheduled tracking data only, so it costs nothing extra. On its day it reads the first tracking run on or after that day and compares it with the two weeks before you set it. For a change that went live, it uses the change's own impact measurement instead.

The result is one of **Improved**, **No meaningful change**, **Declined** or **Not measurable**. A change of under 3 points is **No meaningful change**. If the tracking data isn't in yet, the check waits up to 3 days.

## Where the result goes

The result comes to the chat that set the check, and to the top of your **Inbox** with **Open**. If you no longer have the brand, or have left the workspace, by the check's day, the check closes without a result.

## Agents

An agent that publishes a change sets its own check. It runs after the agent's follow-up days, and its result comes to the agent's chat.
