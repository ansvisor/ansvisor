---
title: Ads Campaigns, your plan and the safety rules
route: /dashboard/ads
keywords: [ads campaigns, campaigns tab, campaign spend, cpc, cost per conversion, google ads campaigns, chatgpt ads campaigns, your plan, ads add-on, add ads add-on, compare plans, talk to us, safety, ad spend]
synonyms: [paid campaigns, campaign list, ads plan, ads add-on price, who can spend]
plan: growth
updated: 2026-11-22
last_checked: 2026-11-22
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_campaigns.tsx, server/src/lib/ads/campaigns.js]
---
The **Campaigns** tab of **Ads** lists the campaigns of the ad accounts connected to this brand, Google Ads and ChatGPT Ads in one table, over the period picked at the top (7, 30 or 90 days). The most spent come first.

Each row shows **Campaign** (and its ad account), **Channel**, **Status**, **Spend**, **Clicks**, **CPC**, **Conversions** and **Cost per conversion**. Money is in each ad account's own currency: nothing is converted. Ansvisor reads the numbers once a day.

With no ad account connected, the table says so; **Open Connections** opens the Connections tab. Right after connecting, it says the first numbers arrive within a day. If an account needs attention, a note above the table says so.

## Your plan

The **Your plan** strip names your plan:

- On Growth, Campaigns is read-only: you see spend and results once an ad account is connected. Building and changing campaigns needs Enterprise or the Ads add-on. **Compare plans** shows the plans. **Add Ads add-on** opens our contact form: talk to us, and for now we set up the add-on with you.
- On Enterprise, and on a self-hosted install, you'll build and change campaigns once an ad account is connected. Every enable, budget or bid change still needs your click.

## Safety

The **Safety** card sets out rules that Ansvisor enforces, not an agent:

- Every enable, pause, budget or bid change needs a person's click and confirmation, in every mode.
- Agents never spend: an agent can suggest a change, and only a person can make it.
- Ad spend is paid to Google, Microsoft and OpenAI from your own ad accounts. Ansvisor never sees or changes payment methods.

Today Ansvisor only reads your ad accounts: it never changes a campaign.

## On Starter and in the free trial

The tab shows what the Growth plan adds, with **Upgrade**.
