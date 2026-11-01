---
title: See and run your agents in Agent Center
route: /dashboard/agents
keywords: [agents, agent center, chat agents, ready to use, ready-to-use agents, use this agent, your agents, new agent, create agent, edit agent, delete agent, run now, pause agent, resume agent, archive agent, agent ai use, agent runs, triggers, max per run, schedule, signal trigger, needs you, stopped at its limit, run agent on an action, agent connections, required connection, agent skills, follow-on skills, buyer questions, rival brief, listing gaps, site audit fixes]
synonyms: [my agents, saved agents, automations, scheduled agents, agent templates, ready-made agents, agent gallery, agent history, what does this agent cost, make an agent, change an agent, remove an agent]
plan: all
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/config/dashboard.ts, web/src/lib/chat/agent-rules.ts, web/src/lib/chat/agent-form.ts, web/src/lib/chat/agent-triggers.ts, web/src/lib/chat/agent-driver.ts, web/src/lib/chat/agent-skills.ts, web/src/lib/chat/agent-connections.ts, web/src/lib/chat/agents/catalog.ts]
---
An agent is a saved skill, mode, connections and model that runs in Chat again and again: on a schedule, when Action Center finds a signal, when a KPI changes, or when someone clicks **Run now**. **Agent Center** offers ready-to-use agents and lists every agent you can see, and each agent has its own page with its triggers, its runs and how much of your monthly AI limit it uses.

## Open Agent Center

Click **Agent Center** on the left menu, right under **Chat**. It has a page of its own, outside Chat. It is also in the chat menu, under **Inbox**, where it shows **New** until you first open Agent Center. You can also press Ctrl K (⌘K on a Mac) in Chat and type "Agent Center". Old links to Agents in Chat open Agent Center.

It has two tabs: **Ready to use**, which opens first, and **Your agents**. In **Your agents**, the filters above the list show how many agents each holds:

- **Mine**: the agents you own.
- **Workspace**: the agents shared with everyone in your workspace. Admins also see their teammates' private agents here.
- **Paused** and **Archived**: agents that are off.

Type in **Search by name or skill** to find an agent by its name or by a skill it uses.

## Ready-to-use agents

**Ready to use** shows agents set up for common jobs, such as **Visibility Watch**, **Citation Win-back** and **Weekly Report**. Each card says what the agent does, its skills, what starts it and its mode. Filter them by goal, such as **Visibility** or **Reporting**.

Admins and Managers click **Use this agent**. **New agent** opens with its skills, triggers, mode and connections filled in, for the brand you have open. Change what you like, then click **Save as draft** or **Turn on**. Nothing turns on by itself.

If your plan doesn't include an agent's mode, its card says which plan does, and the agent opens on **Auto, ask before changes**. Cards marked **Soon** say what they're waiting for and can't be used yet.

## What each card shows

In **Your agents**, each agent has a card with:

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

## Skills an agent can use

Step 1 lists the same skills Chat offers. Besides **Win back lost citations**, **Weekly report** and the other content and reporting skills, there are the skills for what you focus on: **Buyer questions**, **How AI compares us**, **No clear leader**, **Who AI recommends by market**, **Listing gaps**, **Rival brief** and **Site audit fixes**. Each card says which connections it uses. These seven work from your Ansvisor data and public pages, so they need no connection. An agent can run up to 2 follow-on skills after its first one, for example **Comparison page** after **How AI compares us**.

## Connections

Step 4 lists the connections the agent's skills use. **Any CMS** counts Webflow, WordPress, Framer, Wix or a workflow webhook. **Any catalog source** counts Merchant Center, a product feed, an upload or a store.

A **Required** connection is one a skill can't work without, such as a CMS for **Ready to publish**. If the brand doesn't have it, the run doesn't start: **Run now** and **Run agent** say which brand lacks it, and an agent that runs on its own pauses with "A required connection is off". **Resume** doesn't turn the agent back on until every brand in its scope has its Required connections: it says which brand lacks which one. An **Optional** one, such as Search Console for **Weekly report**, helps but isn't needed: without it, the agent does everything else and says what it couldn't use.

## Edit or delete an agent

On an agent's page, click **Edit** to open the same four steps with its current settings. An agent that is on or paused has **Save changes**; a draft has **Save as draft** and **Turn on**. A change to what it does saves a new version, and a run that already started keeps the version it started with. If someone saved the agent after you opened it, click **Reload** to see their change first.

Managers edit their own agents, and Admins every agent. If your Admin keeps workspace agents to Admins, Managers can't change their agents shared with the workspace either. Analysts and Agency partners see a read-only line with **Ask your Admin** instead.

To delete an agent, archive it first. Then open **⋯** on its page and click **Delete**. Chat asks first; its past runs and files stay.

## When an agent runs by itself

A **Schedule** trigger runs at its time on the clock of the time zone it was set in, also when summer time starts or ends. A time missed while the agent was paused isn't made up later. A **Signal** trigger runs when Action Center finds a new signal of its category, and of the definitions, pages and engines you picked. **KPI changed** and **Watch rule** triggers are saved, but don't start runs yet.

Signals that come close together don't each start a run. Signals within 15 minutes join one run, a brand gets at most one signal run every 6 hours, and your plan sets how many signal runs an agent may start a day. A signal that had to wait is listed in the agent's next run, and in **Run history** as **Skipped** with the reason.

## How a run works

Each run works on one brand, in a chat of its own. A run a trigger started acts as the agent's owner, with their role; **Run now** acts as the person who clicked it. The chat shows in that person's Inbox.

A run may use only its share of your monthly AI limit. A run a trigger started ends **Stopped at its limit** when it reaches it; a **Run now** run pauses there instead. After 3 failed runs in a row the agent pauses. When the monthly AI limit is used up, the agent pauses and starts again by itself once the limit resets.

## When a run asks before a change

A **Run now** that starts as you click it follows the agent's mode, so in **Full auto** it makes changes without asking. A run that starts without you, from a trigger or after waiting for a free slot, asks before most changes, whatever its mode. Some still follow the mode, with the role and access of the person the run acts as: creating and changing Content drafts, reviewing or dismissing content opportunities, dismissing prompt suggestions and **Send to Action Center**. In **Full auto** the run makes them without asking; in **Ask me first** it asks. The run reads the agent's mode again before each change. Every change is in the **Activity** log, with **Undo**. When a change needs approval, the run shows **Needs you** and waits. After 7 days without an answer it stops with **No answer in 7 days**.

## On your own AI key

When your workspace runs Chat on its own AI key, agents run on it too. The provider bills your account, and your monthly AI limit doesn't move. **Max per run** and **Monthly cap** still apply: what a run uses is measured at the providers' list prices.

## Run an agent from Action Center

Admins and Managers can also start an agent from an open action in Action Center: **Run agent** on the action's row or at the top of the open action lists the agents that work on its brand. The run works on that action alone, acts as the person who clicked, and opens beside the action. Its chat is named after the agent and the action, and **Run history** shows its trigger as **Run agent from an action**.

The run never adds targets to the action and never closes its tasks. If the action is completed or dismissed, the run stops with **The action was closed**. The action's **History** shows **Agent run started** and **Agent run completed**.

## Read-only roles

Analysts and Agency partners see agents but can't create, run or change them. Agency partners see only agents that work on brands shared with them. The list says you see agents read-only, with **Ask your Admin** to send a request. If a button is refused, for example by your role or your plan, Chat shows why, who can do it and what to do next.

## When your AI key fails

When your workspace runs on its own AI key and the key fails (the provider turns it down, the account is out of credit, or the key can't reach its model), a run ends **Stopped · AI key not working**. An agent a trigger started pauses with **Your AI key isn't working**. These runs don't count toward 3 failed runs in a row.

While the key fails, Agent Center says so at the top, and **Run now**, **Run agent**, **Turn on** and **Resume** are refused before anything starts. Admins get **Fix in AI Providers**; others read that an Admin can fix it there.
