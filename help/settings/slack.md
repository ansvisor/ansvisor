---
title: Send a brand's Daily Pulse and alerts to Slack
route: /dashboard/settings/integrations
keywords: [slack, slack channel, connect slack, pulse in slack, daily pulse, drop alert, daily suggestion, agent needs me, notifications]
synonyms: [post to slack, slack integration, send updates to a channel, slack app, team chat alerts]
plan: starter
updated: 2026-11-10
last_checked: 2026-11-10
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/self-host/env-variables.mdx]
---
Each brand can post to one Slack channel: its **Daily Pulse**, with the same numbers, highlights and warnings as the Pulse e-mail, an alert when visibility or citations drop more than usual, one daily suggestion, and a message when an agent needs someone. Each message links back to Ansvisor. Slack is on every paid plan.

## Connect Slack

In **Settings › Integrations**, find **Slack** under **Team and alerts**, for the brand open now. Admins and managers can connect it.

1. Click **Connect Slack**. Slack opens in a new window: pick your workspace and allow the Ansvisor app.
2. Back in Ansvisor, pick the **Channel** the brand's messages go to. Search by name.
3. Click **Send a test message** to check it arrives.

A public channel works right away. A private channel shows in the list once the Ansvisor app is in it: in Slack, type /invite @Ansvisor in that channel.

If another brand already posts to a Slack workspace, **Use the same workspace as…** uses it without connecting again.

## When the Pulse is posted

With **Daily Pulse** on under the channel, the Pulse is posted as often as it goes out by e-mail: **Daily**, **Weekly** on Mondays, or **Only when notable** (the default). Change how often in **Settings › Notifications**. When it is **Off** there, nothing is posted. Turn **Daily Pulse** off on the Slack card to keep the e-mail and stop the Slack post.

Each Pulse is posted once. If Slack doesn't take it, Ansvisor tries once more, then leaves it for that day.

## Drop alerts

With **Drops beyond normal swing** on, Ansvisor checks the brand after each daily tracking run. When its visibility or its citation rate fell more than its usual swing, the last 7 days against the 7 before, it posts what fell, from what to what, and how far normal swing goes for these prompts.

Only prompts tracked in both weeks count, so adding or removing prompts or engines isn't a drop. Each metric is alerted on at most once a week. Where the new Chat is on, **Ask Chat why** opens it with the question ready, to see what changed it.

## Daily suggestion

With **Daily suggestion** on, the channel gets one Action Center action a day for the brand. Daily suggestions are each person's own, in their Chat Inbox: the channel gets the action most of the brand's people were suggested that morning, with its priority, how long it has waited, and **Open in Action Center**. It is posted once a day, with the first suggestions of the day.

## Agents that need someone

With **Agents that need someone** on, when an agent's run on the brand stops to ask someone or wait for their OK, the channel gets a message that mentions them, with **Open the run**. Only for people who chose **Inbox + Slack** under **Notify me when an agent needs me** in their Chat settings, and only once per run. Ansvisor finds their Slack account by their email; when it can't, the message names them. If the brand doesn't post these, they get the email instead.

## When the card asks you to reconnect

- **Reconnect**: Slack no longer accepts the connection, for example because the app was removed from the workspace. Click **Reconnect Slack**.
- **Paused**: the person who connected Slack can no longer see this brand, so nothing is posted for it. Reconnect, or use another brand's workspace.
- **Pick a channel**: the channel was archived or deleted, or the app was removed from it. Pick another one.

## Disconnect

**Disconnect** stops posting the brand's messages. Other brands that use the same workspace keep theirs, and messages already posted stay in Slack. Disconnecting works even when your plan has ended.

People who aren't admins or managers see which channel the brand's messages go to. On the sample brand, Slack shows as connected with sample data. If Ansvisor runs on your own server, the card says **Not configured** until Slack is set up there.
