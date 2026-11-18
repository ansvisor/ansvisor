---
title: Ads: earn the AI answer, pay for it, or both
route: /dashboard/ads
keywords: [ads, advertising, paid ads, earn or pay, buying-intent prompts, sponsored ads, ads in chat, /earn-or-pay, /ad-drafts, paid opportunity, paid opportunity agent]
synonyms: [ad campaigns, paid search, ppc, chatgpt ads, google ads, microsoft advertising, advertise in ai answers, pay for ai answers, weekly ads agent]
plan: all
updated: 2026-11-16
last_checked: 2026-11-16
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_ads-view.tsx, web/src/config/dashboard.ts, web/src/lib/menu-access.ts, server/src/routes/ads.js, skills/earn-or-pay/SKILL.md, skills/ad-drafts/SKILL.md, web/src/lib/chat/registry/ads-tools.ts, web/src/lib/chat/agents/presets/paid-opportunity.json]
---
**Ads** shows, for each buying-intent prompt, whether to earn the AI answer with content, pay for an ad beside it, or do both. It sends the content fix to the **Action Center** and writes ad drafts from your approved brand facts. Ads sits under **Analytics**, after **AI Referral Traffic**, with a **New** pill. It's still in preview, so it shows only where it's turned on.

## The five tabs

- **Overview**: your buying-intent prompts, how many you cover, and the earn-or-pay bar.
- **Opportunities**: each prompt with its decision, and a drawer to act on it.
- **Paid SoV**: your share of the sponsored ads in AI answers. It's not measured yet.
- **Campaigns**: your plan and the safety rules, until an ad account can be connected.
- **Connections**: the ad platforms and Google Analytics.

The period switch (**7d**, **30d**, **90d**) works on **Overview** and **Opportunities**, and **Export** on **Opportunities**.

## Nothing reaches an ad platform

Ads never sends, publishes or launches an ad, and never spends. Decisions, Action Center tasks and ad drafts stay in Ansvisor. To run an ad, you copy a draft or export a file and use it in your own ad account. Spend, campaigns and their results show once an ad account is connected, and no ad account can be connected yet.

## Who can do what

- Everyone who can see the brand reads Ads, copies drafts and copies a campaign brief.
- Admins and Managers change a prompt's decision, send fixes to the Action Center, create and edit ad drafts, and export.
- Only Admins change the earn-or-pay thresholds.
- Anyone can click **Notify me** on a platform that comes later.

## Plans

Ads is included from the Growth plan. On Starter and in the free trial, you see the whole **Overview** and the first rows of **Opportunities**, with a lock row for the rest and **Upgrade**. **Paid SoV**, **Campaigns** and **Connections** show what Growth adds. Changing decisions, sending fixes, ad drafts and exports need Growth or above, and aren't part of the free trial.

## The demo brand

On the demo brand, Ads shows every tab and row as Growth has them, with the rule's own decisions. You can open every drawer, but nothing changes there: there's no decision menu, **Export**, **Send to Action Center** or **Create ad drafts**, and **Notify me** opens the plans.

## Ask Chat about Ads

With Chat open beside **Ads**, it knows the page and reads its period, and suggests questions such as "Which buying-intent prompts should we pay for?". Asked anywhere else, Chat reads Ads over 30 days, as the page opens, unless you name another period. Two skills cover Ads:

- **Earn or pay** (**/earn-or-pay**) explains a prompt's decision: why, who AI picks, where you stand and its searches, with one next step. It never changes a decision.
- **Ad drafts** (**/ad-drafts**) writes or rewrites a prompt's drafts from your approved brand facts. Admins and Managers save them on a card they approve.

Chat reads the same rows your plan shows on the page, and says what isn't measured instead of guessing.

## The Paid Opportunity agent

**Paid Opportunity** is a ready-to-use agent in **Action Center › Agents**. It runs every Monday at 09:00 on **Auto, ask before changes**, with **Earn or pay**, then **Ad drafts**. Each run reads the last 30 days and starts with what changed since last week: new buying-intent prompts and decisions that moved. The first week has nothing to compare, so it lists the prompts. Who pays isn't measured yet: it says so, never guesses.

It then suggests next steps, and writes drafts only for prompts that moved to **Pay** or **Earn + pay**. Nothing is saved by itself: drafts and Action Center fixes wait on cards in the agent owner's **Inbox** until they click **Approve**. On Starter and in the free trial, it reads only the first rows the page shows and can't save drafts.

## On the menu

Ads is a menu section like the others. Admins, and the managers they let, can take it off a role's menu or a person's in **Settings › Menu access**. People who pick what they work on see it with **Founders & leaders**, **Growth** and **Analytics**.
