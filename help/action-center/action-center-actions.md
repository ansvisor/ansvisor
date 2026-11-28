---
title: Work with Action Center actions
route: /dashboard/action-center/actions
keywords: [actions, today, todays focus, agent work, i approve first, agent starts on its own, action status, assign action, dismiss action, export actions, top actions, run agent, run with chat, stale actions, still relevant, replaced actions, no new actions, confidence, sort actions, recently updated, action number, find action by number, action code, previously, translated, your language, new since your last visit, closed this week, refreshed this week, deleted actions, missing actions]
synonyms: [recommendations, work items, to-dos, action list, let an agent do this, agent on an action, what should I do today, what to do first, who starts agent work, order actions, newest first, oldest first]
plan: all
updated: 2026-11-29
last_checked: 2026-11-29
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx, server/src/lib/action-center/generate.js]
---
An action is one piece of work with an outcome, built from the evidence behind it. Ansvisor groups many signals into one action: six valuable pages with no AI traffic become one "Capture AI traffic" action with six linked signals, not six rows. New actions are added after the daily tracking run, on the **Actions** tab.

## Today's focus

What to do today is on the **Today** tab: **Today's focus** lists your three highest-impact open actions that are yours or no one's yet, ranked as your daily suggestion in Chat is. That's the **Priority Score**, plus a little for each day an action has waited and for writing you can start in the Content Editor now. The **Actions** tab lists every open action; sort it by Priority to see what comes next.

## Agent work

When Chat is on, the **Agent work** gear beside **Today's focus** sets how far your workspace's agents go without a person:

- **I approve first**, where every workspace starts: each change an agent makes waits for someone's OK.
- **Agent starts on its own**: each agent follows its own mode, **Ask me first**, **Auto** or **Full auto**.

Either way, agents always ask before publishing or sending. The exception is an agent an Admin has allowed to publish and send on its own. Only Admins change the setting; everyone sees it, with who changed it last and when. The panel opens above the gear, clear of the focus rows' buttons. It is also in **Settings › Chat**.

## Action categories

- **Growth**: ground you could win, such as demand, topics, platforms or pages where you could appear more.
- **Protect**: ground you hold that is starting to slip.
- **Recover**: ground you held and lost, in visibility, citations, mentions or traffic.
- **Fix**: issues on your own site, such as low audit scores, blocked crawlers or broken links AI sends people to.
- **Compete**: places where competitors lead you.

## Dots on actions

A dot beside an action's title, in the list and in its drawer, says what changed. It sits next to the status, which stays as it was.

- **Red, with a !**: a task failed, the agent's last run on it failed, or its page didn't reach your CMS.
- **Yellow**: a task waits for approval, a draft is in review, or the action is due today or overdue.
- **Green**: its outcome was measured (Improved or No change) since you last opened it. Opening it clears the dot.
- **Grey, pulsing**: an agent is working on it, its tasks are being written, or its draft is being written.

Red and yellow are for admins and managers. Point at a dot to read why.

## Cards and filters

The cards at the top count and filter the list, all but **Highest Priority**. Click one to narrow the table, and click it again to clear it.

- **Top Actions**: the five highest-priority open actions.
- **At Risk**: open Recover and Fix actions.
- **Opportunities**: open Growth actions.
- **In Progress**: actions someone is working on.
- **Highest Priority**: the highest level among open actions; it doesn't filter.

Below them, filter by category, **Priority**, **Status** (including **Open** and **Stale**) and **Assignee**, or search. **Status** starts on **Open** (new, in progress and on hold, anyone's), the number Today shows; pick **All** to add closed ones. Each row shows the action's code under its title, such as AC-07, the code Chat uses for it: search for AC-07 or 7 to find it. For an online shop, the **From Products** chip lists only the actions sent from Products.

## New and closed actions

Above the list, a line reads like "55 open · 12 closed this week · 3 new since your last visit · 5 refreshed this week". The open count doesn't always grow: a new finding on the subject of an open action joins it, closed actions leave the count, and a refreshed action is replaced by its new one.

- **New**: a mark beside each action created since your last visit on this browser, gone on the next one.
- **Closed this week**: completed or dismissed in the last 7 days. Click it to list them; **Clear filters** goes back.
- **Refreshed this week**: untouched for 30 days and replaced by a new action built from fresh data. Not counted as closed; its **History** names the new one.

Actions are never removed on their own. Closed ones stay under **Status: All**, with what happened in each one's **History**.

## Action codes

Each brand numbers its own actions from AC-01, in the order they were made, and an action keeps its code for good. A number is never used again, so the list has gaps where actions were done, dismissed or removed. Actions made before this had an older code, such as AC-648: the drawer shows it as "Previously AC-648" beside the new code, searching for it still finds the action, and links made with it still open it.

## Sort the list

The list opens on **Recently updated**: the most recently changed action first, by the date in the **Updated** column. **Sort** also offers **Priority**, the highest Priority Score first, and **Due date**, the soonest first.

Click the **Updated** column's header to sort by it, most recent first, and click it again for the oldest first. While the list is sorted by a header, each click turns it the other way round. The **Priority Score** header works the same way: highest first, then lowest. An arrow shows which way the list is sorted.

Filters and the sort are kept in the page's address, so a sorted, filtered view can be shared.

## Status, dismiss and delete

An action's status is **New**, **In Progress**, **On Hold**, **Completed** or **Dismissed**. The row menu sets In Progress, Completed or Dismiss without opening the action.

Dismissing asks why: it doesn't matter to us, it's already done, the data behind it is wrong, or not now. You can also dismiss without saying why. History shows the reason.

**Delete**, for admins and managers only, removes an action for everyone, and it won't come back on its own the next day.

## Stale actions

An action that has stayed **New** for 30 days, with no one assigning, editing, sending or updating its tasks, is marked **Stale** each night. It isn't closed or dismissed: its row keeps one status, **New**, with "No update in 44 d" under it, the open action shows a **Stale** label, and the **Status** filter's **Stale** lists them all.

If it still matters, click **Keep** in the open action, or **Still relevant** in the row menu. The hint and label go, its 30 days start again, and History says who kept it. Any other change to the action, or moving it out of New, clears the label too. If it no longer matters, click **Dismiss**.

An open action whose signals have all resolved shows **Signal resolved, review** instead of a signal count. It stays open: check whether the work is done, then complete or dismiss it.

## Replaced actions

If a stale action's kind still finds something, the nightly run replaces it: it closes the old one and opens a new action of the same kind from the latest findings, the old one's open signals included. History shows the old one as **Replaced by a newer action**, not as dismissed by you. An action someone is working on, or kept with **Still relevant**, is never replaced.

## The top of an action

Click a row to open the action. Its top line shows the priority and the action's code, and **⋯** beside them holds **Run agent**, **Copy Data** and the exports. Under the title, small boxes count what it affects (prompts, pages, platforms and so on), and you set **Status**, **Assignee** and **Due date**.

## Inside an action

An open action's tabs:

- **Overview**: **Why this priority?**, with how many kinds of evidence agree (Single source, Confirmed or Well confirmed, and why, such as one kind of finding from one source), **Why this action?** with the signals behind it, the **Goal**, with **Done when** (what done looks like, with a date) and the linked **KPIs**.
- **Affected**: the prompts, pages, topics, competitors or platforms it is about, with each prompt's demand.
- **Tasks**: the work, step by step, with how many are done, such as **Tasks 2/5**.
- **Signals**: the evidence. Click one to open it on the Signals tab.
- **History**: every change, from status and assignee changes to tasks updated or sent.

The title's count, **Why this action?**, the **Goal**'s "5 of 7 prompts" and the AI searches a month all count the same prompts as the **Affected** tab, so the monthly searches are the sum of its rows.

## A goal date that has passed

The **Goal** is set for the action's due date, or 30 days after it was raised. Once that day has gone and the action is still open, **Goal date passed** shows under it, with **Set a new date**, which takes you to **Due date**. The date never moves on its own, so a missed goal stays visible.

## In your language

Most of an action's words come from the interface, so they follow your language. Actions sent from Chat or Improve carry a title, a "why" and a goal written in English, and an action sent from a content opportunity carries the opportunity's title. When your interface language is another, these show in your language: in English for a moment the first time, then translated. Each is translated once and kept for teammates who use the same language.

## Run an agent on an action

When Chat is on, Admins and Managers see **Run agent** on each open action: an agent button next to its title in the list, and in the **⋯** menu at the top of the open action.

It lists your agents that work on the action's brand, the ones used on this kind of action first. Pick one, and Chat starts a run on this action alone and opens it beside the action. **Run with Chat** does the same without an agent, in your default mode. **Create an agent for this kind of action** starts a new agent from a fitting skill.

The run drafts the work, but closing tasks stays your click. If the action is completed or dismissed, an agent's run stops; a **Run with Chat** run doesn't. The action's **History** shows when a run started and ended, and who started it.

## Assign work

An action with no one on it belongs to **Everyone** in the workspace until someone takes it. Pick a teammate in the action's **Assignee** field, and set a **Due date** if it has one: click the date to open a calendar in your language, pick a day with the mouse or the arrow keys and Enter, or use **Today**; **Clear** removes it. The date saves as you pick it. The **Assignee** filter on the Actions tab shows one person's actions, or **Everyone** for the unassigned ones.

## Export actions

**Export CSV** on the Actions tab downloads the actions in the current view, as filtered, with their number, priority, status, assignee, due date, task progress and affected items.

Inside an action, the **⋯** menu's **Copy Data** gives the whole action as Markdown to paste into a doc or ticket, and **Export CSV** or **Export Excel** downloads it. The Excel file has one sheet each for the action, its affected items, tasks, signals and history.

## Send work here from other pages

Most actions come from signals each night, but you can also send work to the Action Center:

- **Mentions**: select answers, or open one, and click **Send to Action Center**.
- **Content**: **Send to Action Center** on a content opportunity, or **Assign to…** on a Content Plan row.
- **New content**: send it to a teammate with **Send to Action Center**.
- **Site Audit**: **Send to Action Center** on a page's audit report.
- **AI Referral Traffic**: select pages and click **Send to Action Center**.
- **Visibility**: **Send action** on a topic in Opportunities.
- **Product Visibility**: pick the work in a product's plan and click **Send … actions to Action Center**.
- **Prompts**: **Send Actions** on a prompt's Improve tab.
- **Chat**: **Send to Action Center** under an answer. Its Overview links back to the chat.

Sending the same thing twice doesn't create a second action: the page says it is already in the Action Center.
