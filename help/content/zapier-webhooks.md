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
Send a brand's Ansvisor events to a Zapier workflow. Each brand has its own webhook URL and secret, so configure the connection separately for every brand you want to use.

## Configure the brand webhook

Open the brand's **Content** area and choose **Configure Webhook**. Paste the hook URL from the Ansvisor trigger in Zapier, choose the events the workflow should receive, and set a secret key. Save the webhook and use an HTTPS address.

## Connect the trigger in Zapier

In Zapier, add the matching Ansvisor trigger and connect the brand's webhook secret. Use a separate Ansvisor connection for each brand because the secret belongs to one brand. The same API key can be used in those connections.

## Test the connection

Choose **Test Webhook** in the brand's webhook settings. In Zapier, use **Webhook Test Received** to confirm the event arrives. The Daily Pulse, Content Draft Sent and Action Center Task triggers each receive their own event type.
