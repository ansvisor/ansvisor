---
title: Connect Ansvisor to Zapier
route: /dashboard/content
keywords: [Zapier, webhook, automation, Daily Pulse]
synonyms: [send Ansvisor events to Zapier, connect Zapier, Zapier workflow]
plan: all
updated: 2026-11-08
last_checked: 2026-11-08
owner: Ansvisor
app_version: 0.3.0
approved: false
sources: [docs/guides/zapier.mdx, docs/api-reference/webhooks.mdx]
---
Send a brand's Ansvisor events to a Zapier workflow. Each brand has its own private connection value, so connect a separate Ansvisor account in Zapier for each brand you want to use.

## Connect your account

Create an API key under **Settings → MCP & API Keys** and add it to the Ansvisor connection in Zapier. For webhook triggers, also enter the private value configured for the target brand. The key's user must be an admin or manager with webhook write access.

## Enable a webhook trigger

Add a Daily Pulse, Content Draft Sent or Action Center Task trigger and choose the brand. When you enable the Zap, Ansvisor registers the webhook URL automatically. Turning off or removing the Zap removes that subscription.

## Test the connection

The **Test Webhook** control in Ansvisor tests the dashboard's Default webhook URL; it does not send a test event to API-managed Zapier subscriptions. Use the sample payload in Zapier while setting up the trigger, then enable the Zap and send a real event to verify delivery.