---
title: Get daily suggestions in your Chat Inbox
route: /dashboard/chat/inbox
keywords: [daily suggestions, inbox, suggestion, pause daily suggestions, turn back on, action center, one action a day, inbox tabs]
synonyms: [daily tips, what should I do today, suggested action, stop suggestions, daily nudge]
plan: all
updated: 2026-10-30
last_checked: 2026-10-30
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/lib/chat/daily-suggestions.ts]
---
Each morning Chat can pick one action that waits in your Action Center and put it in your **Inbox**, with what it would take, so your open actions get done. It picks from what is already there, by its priority, and adds no new work. Picking costs no AI usage.

## The Inbox tabs

The **Inbox** has tabs on top, each with its count:

- **All**: everything below.
- **Daily suggestions**: the actions picked for you.
- **Needs you**: chats waiting for your OK.
- **Runs**: chats still working, and results you haven't opened.

The line under **Inbox** counts what needs you, what runs and the suggestions of this week.

## Daily suggestions

You get at most one a day for each brand, and at most 7 a week. Each row shows the action's title, its number in the Action Center, its priority, how it can be done, such as **Content Editor or Chat · about 20 min**, and the day it came.

The dot shows where it stands: blue while it's new, no longer blue once you've seen it, and green once you started it. The list shows the last 7 days only.

Click a row, or **Open**, to open the action in the Action Center.

## Who gets them

Admins and Managers get them for every brand of the workspace. Agency partners get them once they open the **Inbox** for the first time. Analysts don't get them. The demo brand gets none, and a workspace whose plan ended gets no new ones: its list keeps what it has.

## Pause or turn them back on

Click **Pause daily suggestions**, on the **Daily suggestions** tab, to stop them for all your brands. Your Action Center is unchanged.

When you haven't opened or used any suggestion for 30 days, Chat stops picking them and says **Daily suggestions are paused**. Seeing them in the **Inbox** doesn't count as using them.

Click **Turn back on** to start them again: the first one arrives the next morning.
