---
title: Connect HubSpot
route: /dashboard/settings/integrations
keywords: [hubspot, connect hubspot, crm, ai-sourced contacts, ansvisor properties, hubspot consent]
synonyms: [link hubspot, hubspot integration, crm integration, mark ai contacts in hubspot, disconnect hubspot]
plan: growth
updated: 2026-11-10
last_checked: 2026-11-10
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json]
---
HubSpot shows which contacts, deals and revenue a brand's AI answers bring. Each brand connects its own HubSpot account, or uses the account another brand uses. HubSpot comes with the Growth plan and above.

## Connect HubSpot

Open **Settings › Integrations** and find **HubSpot** under **CRM**. Admins and managers click **Connect HubSpot**. Ansvisor first asks what it may do in HubSpot:

- **Mark contacts who came from an AI answer**: Ansvisor creates a property group called **Ansvisor** with six contact properties, fills them on contacts who first came from an AI answer and then converted, and reads those contacts and their deals for its report. A contact that already has an AI source keeps it.
- **Send pages to HubSpot as drafts**: lets Send to CMS create draft pages. You publish them in HubSpot.

Tick at least one, click **Continue to HubSpot**, then sign in to HubSpot and approve the access in the window that opens.

## Send pages to your HubSpot blog

With **Send pages to HubSpot as drafts** on, the card has **Blog posts go to**: pick one of the HubSpot account's blogs and click **Save**. **Send to CMS** then offers HubSpot, and each page goes to that blog as a draft post. You publish it in HubSpot. If HubSpot didn't give Ansvisor access to its blogs, the card asks you to connect HubSpot again.

## What Ansvisor never does

Ansvisor never deletes contacts or deals, never changes your own properties, never publishes a page, and never copies names or emails into Ansvisor. Nothing is written to HubSpot without the choices above.

## Change what Ansvisor may write

The HubSpot card has a switch for each choice. Turning one off stops it at once. The card says who allowed the writes, and when. If the Ansvisor properties couldn't be created, the card says why, with **Try again**.

## Share one HubSpot account between brands

When another brand already uses a HubSpot account, pick it from **Use the account another brand uses**. Each brand still chooses what Ansvisor may write. The card lists the other brands on the same account.

## Disconnect, or a plan change

**Disconnect** stops all reading and writing for the brand at once. The Ansvisor properties and their values stay in HubSpot. If the plan no longer includes HubSpot, the card says **Paused**: nothing is read or written until you upgrade, and the connection stays.
