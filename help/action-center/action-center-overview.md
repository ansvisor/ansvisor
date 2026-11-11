---
title: Action Center overview
route: /dashboard/action-center
keywords: [action center, actions, signals, kpis, history, prioritized work]
synonyms: [to-do list, work list, what to do next, recommendations, home page]
plan: all
updated: 2026-11-11
last_checked: 2026-11-11
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx]
---
The **Action Center** is where Ansvisor turns what changed in AI search into a ranked list of work. Everyone lands on its **Today** tab when they sign in, whatever the plan. Open it from **Action Center**, first in the main menu, under Chat; its tabs are listed under it too. Everything in it is per brand: switch brands to see another brand's work.

## The tabs

- **Today**: what changed since your last visit, today's focus and what waits for you.
- **Actions**: every action, ranked by Priority Score.
- **Signals**: what changed across your AI visibility data.
- **Agents**: your agents and ready-to-use ones, when Chat's agents are on for your workspace.
- **History**: what was done, and what it moved. **KPIs**, the goals you track for the brand, is one of its views.

Admins and managers open **Needs review**, where tasks the AI wrote without some of their details wait for a person, from **Waiting for you** on Today.

## How the work flows

Signals are detected after your daily tracking run. Ansvisor groups related signals into one action, so a long list of findings becomes a few pieces of work. At most five new actions are added per brand per day, so the list stays short enough to act on. Each action comes with tasks. When you close an action as **Completed**, History measures what changed afterwards.

## While the first tracking runs

While a new brand's first tracking runs, one thin line sits under the tabs: **First tracking running**, how many of its checks are done and about how long is left. If another analysis is running, the line says **First tracking queued** until a slot opens. Click **Details** to read what it means and follow the run on Visibility. Actions, signals and KPIs fill in once it finishes, and the line goes away. Meanwhile, Today asks you to check the prompts we track and lists the set-up steps left.

## A weekly routine

Start each day from **Today's focus**, and work from the **Top Actions** card each week. Assign each action, set a due date, and close it as **Completed** when its tasks are done, so History can measure the result.
