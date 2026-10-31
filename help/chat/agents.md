---
title: See and run your agents in Agent Center
route: /dashboard/agents
keywords: [agents, agent center, chat agents, new agent, create agent, edit agent, delete agent, run now, pause agent, resume agent, archive agent, agent ai use, agent runs, triggers, max per run]
synonyms: [my agents, saved agents, automations, scheduled agents, agent history, what does this agent cost, make an agent, change an agent, remove an agent]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/config/dashboard.ts, web/src/lib/chat/agent-rules.ts, web/src/lib/chat/agent-form.ts]
---
An agent is a saved skill, mode, connections and model that runs in Chat again and again: on a schedule, when Action Center finds a signal, when a KPI changes, or when someone clicks **Run now**. **Agent Center** lists every agent you can see, and each agent has its own page with its triggers, its runs and how much of your monthly AI limit it uses.

## Open Agent Center

Click **Agent Center** on the left menu, right under **Chat**. It has a page of its own, outside Chat. It is also in the chat menu, under **Inbox**, where it shows **New** until you open it from there the first time. You can also press Ctrl K (⌘K on a Mac) in Chat and type "Agent Center". Old links to Agents in Chat open Agent Center.

The tabs above the list show how many agents each holds:

- **Mine**: the agents you own.
- **Workspace**: the agents shared with everyone in your workspace. Admins also see their teammates' private agents here.
- **Paused** and **Archived**: agents that are off.

Type in **Search by name or skill** to find an agent by its name or by a skill it uses.

## What each card shows

Each agent has a card with:

- A dot and its state: green for **Active**, amber for **Paused** with the reason, grey for **Draft** and **Archived**.
- Its skills, its mode and the person who owns it.
- **Trigger**: what starts it, for example "Every Mon 09:00 · New Recover signal", and **Next run**.
- **Scope**: the brand it works on, or how many brands.
- **Last run** with its state, and **Outcomes · 30 days**.
- **AI use · 30 days**: its share of your monthly AI limit, with a thin bar. Hover over it to see its runs, the average share a run and its cap a run.

Usage is always shown as a share of your monthly AI limit.

## An agent's page

Click **Open** or the agent's name. The top shows its state, its owner, whether it is private or shared, and **This period**: what it used of this month's AI limit, with its monthly cap when one is set. Under it you see its skills, mode, connections and model.

**Triggers** lists what starts it and when it runs next. **Run history** lists its last 50 runs: when each started, its trigger and brand, its result, its outcome and its **AI use**, for example "3.2% of 10%": what the run used and the most one run may use. Filter them with **All**, **Improved**, **Pending** and **Stopped**, and click a run to open its chat.

On the right, **Access**, **Scope** and **AI use** show who owns it, what it may reach and its limits.

## Run, pause and archive

Admins and Managers see the buttons they may use:

- **Run now** starts a run for each brand in its scope. A second click within a minute doesn't start another one.
- **Pause** stops its triggers until you click **Resume**. **Activate** turns on a draft.
- Under **⋯**: **Duplicate** makes a copy as a draft. **Archive** turns it off; its triggers stop and runs waiting to start are cancelled. Admins can also **Take over** an agent, so its triggered runs act as them.
- An archived agent has **Restore**, which brings it back paused.

Managers change their own agents and can run agents shared with the workspace. Admins can do this for every agent.

## Create an agent

Admins and Managers click **New agent** in **Agent Center**. Four steps open, with a summary of the agent on the right:

1. **Skill**: pick what it does, add up to 2 follow-on skills, and write instructions if you like.
2. **Trigger**: add up to 5, such as **Schedule** or **Signal created**. Each shows its next run or when it fires. **Manual** is always on: **Run now**. Next to **FOR**, pick its brands, and narrow it to platforms, topics, prompt tags or URLs.
3. **Mode & approvals**: how much it may do without asking.
4. **Connections & model**: then its name, **Private** or **Workspace**, and **Max per run**, the most one run may use of your monthly AI limit. Admins can also set a **Monthly cap**.

Click **Save as draft** to keep it off, or **Turn on**. If something needs fixing, its step opens and says what to change.

## Edit or delete an agent

On an agent's page, click **Edit** to open the same four steps with its current settings. An agent that is on or paused has **Save changes**; a draft has **Save as draft** and **Turn on**. A change to what it does saves a new version, and a run that already started keeps the version it started with. If someone saved the agent after you opened it, click **Reload** to see their change first.

Managers edit their own agents, and Admins every agent. If your Admin keeps workspace agents to Admins, Managers can't change their agents shared with the workspace either. Analysts and Agency partners see a read-only line with **Ask your Admin** instead.

To delete an agent, archive it first. Then open **⋯** on its page and click **Delete**. Chat asks first; its past runs and files stay.

## Read-only roles

Analysts and Agency partners see agents but can't create, run or change them. Agency partners see only agents that work on brands shared with them. The list says you see agents read-only, with **Ask your Admin** to send a request. If a button is refused, for example by your role or your plan, Chat shows why, who can do it and what to do next.
