---
title: See and run your agents in Chat › Agents
route: /dashboard/chat/agents
keywords: [agents, chat agents, run now, pause agent, resume agent, archive agent, agent ai use, agent runs, triggers, schedule, signal trigger, needs you, stopped at its limit, run agent on an action]
synonyms: [my agents, saved agents, automations, scheduled agents, agent history, what does this agent cost]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/lib/chat/agent-rules.ts, web/src/lib/chat/agent-triggers.ts, web/src/lib/chat/agent-driver.ts]
---
An agent is a saved skill, mode, connections and model that runs in Chat again and again: on a schedule, when Action Center finds a signal, or when someone clicks **Run now**. **Agents** lists every agent you can see, and each agent has its own page with its triggers, its runs and how much of your monthly AI limit it uses.

## Open Agents

Click **Agents** in the chat menu, under **Inbox**. It shows **New** until you open it the first time. You can also press Ctrl K (⌘K on a Mac) in Chat and type "Agents".

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

## When an agent runs by itself

A **Schedule** trigger runs at its time on the clock of the time zone it was set in, also when summer time starts or ends. A time missed while the agent was paused isn't made up later. A **Signal** trigger runs when Action Center finds a new signal of its category, and of the definitions, pages and engines you picked. **KPI changed** and **Watch rule** triggers are saved, but don't start runs yet.

Signals that come close together don't each start a run. Signals within 15 minutes join one run, a brand gets at most one signal run every 6 hours, and your plan sets how many signal runs an agent may start a day. A signal that had to wait is listed in the agent's next run, and in **Run history** as **Skipped** with the reason.

## How a run works

Each run works on one brand, in a chat of its own. A run a trigger started acts as the agent's owner, with their role; **Run now** acts as the person who clicked it. The chat shows in that person's Inbox. When a change needs approval, the run shows **Needs you** and waits. After 7 days without an answer it stops with **No answer in 7 days**.

A run may use only its share of your monthly AI limit. A run a trigger started ends **Stopped at its limit** when it reaches it; a **Run now** run pauses there instead. After 3 failed runs in a row the agent pauses. When the monthly AI limit is used up, the agent pauses and starts again by itself once the limit resets.

## Run an agent from Action Center

Admins and Managers can also start an agent from an open action in Action Center: **Run agent** on the action's row or at the top of the open action lists the agents that work on its brand. The run works on that action alone, acts as the person who clicked, and opens beside the action. Its chat is named after the agent and the action, and **Run history** shows its trigger as **Run agent from an action**.

The run never adds targets to the action and never closes its tasks. If the action is completed or dismissed, the run stops with **The action was closed**. The action's **History** shows **Agent run started** and **Agent run completed**.

## Read-only roles

Analysts and Agency partners see agents but can't create, run or change them. Agency partners see only agents that work on brands shared with them. The list says you see agents read-only, with **Ask your Admin** to send a request. If a button is refused, for example by your role or your plan, Chat shows why, who can do it and what to do next.
