---
title: Send a brand's Pulse and alerts to Slack
route: /dashboard/settings/integrations
keywords: [slack, slack channel, connect slack, alerts in slack, pulse in slack, notifications]
synonyms: [post to slack, slack integration, send updates to a channel, slack app, team chat alerts]
plan: starter
updated: 2026-11-10
last_checked: 2026-11-10
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/self-host/env-variables.mdx]
---
Each brand can post to one Slack channel: its **Daily Pulse**, drops in visibility or citations beyond normal swing, its daily suggestion, and agents that need someone. Slack is on every paid plan.

## Connect Slack

In **Settings › Integrations**, find **Slack** under **Team and alerts**, for the brand open now. Admins and managers can connect it.

1. Click **Connect Slack**. Slack opens in a new window: pick your workspace and allow the Ansvisor app.
2. Back in Ansvisor, pick the **Channel** the brand's messages go to. Search by name.
3. Click **Send a test message** to check it arrives.

A public channel works right away. A private channel shows in the list once the Ansvisor app is in it: in Slack, type /invite @Ansvisor in that channel.

If another brand already posts to a Slack workspace, **Use the same workspace as…** uses it without connecting again.

## Choose what goes to Slack

Under the channel, turn each kind of message on or off:

- **Daily Pulse**: as often as the brand's Pulse goes out. Change how often in **Settings › Notifications**.
- **Drops beyond normal swing**: visibility or citations down more than usual, the last 7 days against the 7 before.
- **Daily suggestion**: one Action Center action a day for the brand.
- **Agents that need someone**: for people who chose **Inbox + Slack** in their Chat settings. They're mentioned in the message.

Everything is on until you turn it off.

## When the card asks you to reconnect

- **Reconnect**: Slack no longer accepts the connection, for example because the app was removed from the workspace. Click **Reconnect Slack**.
- **Paused**: the person who connected Slack can no longer see this brand, so nothing is posted for it. Reconnect, or use another brand's workspace.
- **Pick a channel**: the channel was archived or deleted. Pick another one.

## Disconnect

**Disconnect** stops posting the brand's messages. Other brands that use the same workspace keep theirs, and messages already posted stay in Slack. Disconnecting works even when your plan has ended.

People who aren't admins or managers see which channel the brand's messages go to. On the sample brand, Slack shows as connected with sample data. If Ansvisor runs on your own server, the card says **Not configured** until Slack is set up there.
