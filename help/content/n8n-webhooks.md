---
title: Connect Ansvisor webhooks to n8n
route: /dashboard/content
keywords: [n8n, webhook, workflow, automation, brand events]
synonyms: [connect n8n, send events to n8n, n8n integration]
plan: all
updated: 2026-11-08
last_checked: 2026-11-08
owner: Ansvisor
app_version: 0.3.0
approved: false
sources: [docs/guides/n8n.mdx, docs/api-reference/webhooks.mdx]
---
Send a brand's Ansvisor events to an n8n workflow with the n8n community node. Each brand has its own webhook URL and secret, so set up the trigger separately for every brand you want to connect.

## Configure the brand webhook

Open **Content** for the brand and choose **Configure Webhook**. Enter the Production URL from the n8n **Ansvisor Trigger** node, choose the events the workflow should receive, and set a secret key. Save the webhook. Use an HTTPS address so the secret is protected while it is sent.

## Connect the trigger in n8n

In n8n, add **Ansvisor Trigger** and create a credential containing the same secret you saved for that brand. Activate the workflow, copy its Production URL, and add that URL to the brand's webhook settings. Use a different credential for each brand; do not reuse one brand's secret for another.

## Choose which events to receive

Select the events in **Content › Configure Webhook**. Ansvisor can send content opportunities, Daily Pulse updates, Action Center tasks, Content Editor pages and a test event. The test option lets you check the connection before relying on it. Each event is delivered once, so check the workflow's execution history if a delivery does not arrive.
