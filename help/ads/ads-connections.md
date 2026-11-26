---
title: Ads Connections: ad platforms and Google Analytics
route: /dashboard/ads
keywords: [ads connections, ads sync, daily ad numbers, chatgpt ads, chatgpt ads api key, google ads, microsoft advertising, meta ads, linkedin ads, notify me, connect an ad account, google analytics in ads]
synonyms: [connect google ads, link ad account, ad integrations, facebook ads, instagram ads, ad platform billing]
plan: growth
updated: 2026-11-22
last_checked: 2026-11-22
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_connections.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_chatgpt-ads.tsx, server/src/routes/ads.js, server/src/routes/ads-accounts.js, server/src/lib/ads/sync.js]
---
The **Connections** tab of **Ads** lists the ad platforms Ads works with, and Google Analytics. Ansvisor only reads your ad accounts: it never changes a campaign or a budget.

## ChatGPT Ads

An Admin clicks **Connect** and pastes an **Ads API key** from ChatGPT Ads Manager. Ansvisor checks the key with ChatGPT Ads, then stores it encrypted. The key is never shown again.

Each key reaches one ad account. To add another account, click **Add account** and paste that account's key.

The card shows each account's name, currency and status. **Disconnect** deletes the key and the numbers Ansvisor read; your ads keep running. Other roles see what is connected. On the demo brand, connecting a key opens the plans.

## Daily numbers

Once a day Ansvisor reads each connected account's campaigns: impressions, clicks and spend per day, in the account's currency. The first read covers the last 90 days; every later read refreshes the last 30, since platforms correct recent days.

Under each account the card says when it last read the numbers. If a read fails, the account shows **Needs attention** and why, for example a refused key. Ansvisor tries again the next day. ChatGPT Ads conversions aren't read yet.

## Google Ads

This shows **Coming soon**. It includes ads in AI Overviews and AI Mode.

Billing stays with each platform: ChatGPT Ads Manager, Google Ads or Microsoft Advertising. Ansvisor never sees or changes how you pay for ads.

## Microsoft Advertising, Meta Ads and LinkedIn Ads

These show **Coming later**. **Microsoft Advertising** includes ads in Copilot. Click **Notify me** to hear when that platform is ready; the card then says **We'll tell you**. On the demo brand, **Notify me** opens the plans.

## Google Analytics

The **Google Analytics** card shows your brand's connection: **Connected**, **Not connected**, **Sign-in failed** or **Couldn't check**. **Connect** or **Manage** opens **Settings › Integrations**. It's the same connection Ansvisor uses everywhere: connected there means connected here.

## On Starter and in the free trial

The tab shows what the Growth plan adds, with **Upgrade**.
