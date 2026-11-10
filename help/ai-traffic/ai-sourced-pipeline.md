---
title: AI-sourced pipeline from HubSpot
route: /dashboard/traffic
keywords: [ai-sourced pipeline, ai-sourced contacts, ai revenue, hubspot deals, revenue from ai answers, ai-influenced deals]
synonyms: [which deals came from chatgpt, crm revenue from ai, contacts from ai answers, hubspot ai report, pipeline by ai engine]
plan: growth
updated: 2026-11-10
last_checked: 2026-11-10
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json]
---
**AI-sourced pipeline** on the AI Traffic page shows which HubSpot contacts, deals and revenue came from AI answers, by AI engine and landing page. It needs HubSpot connected for the brand, with **Mark contacts who came from an AI answer** allowed, and the Growth plan or above.

## What the numbers mean

- **AI-sourced contacts**: contacts whose first visit came from an AI answer, up to 30 days before they converted, counted by when they converted.
- **AI-influenced deals**: their deals created in the range. A deal counts once, in full, even when several of its contacts came from AI. It goes to the earliest of those contacts' engine and page.
- **Won revenue**: those deals closed won in the range.
- **Open pipeline**: those deals open now, not weighted by stage.

Amounts are in your HubSpot account's currency. The tables split them by AI engine and by landing page.

## HubSpot's own AI Referrals

HubSpot marks some contacts with its own **AI Referrals** traffic source. Those on your brand's domains that Ansvisor didn't mark show on a line of their own, so nothing counts twice.

## When it updates

Ansvisor reads HubSpot once a day. Admins and managers can read it again with **Sync now** on the HubSpot card in **Settings › Integrations**. Until the first read, the section says it's reading HubSpot.
