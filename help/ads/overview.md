---
title: Ads Overview: buying-intent prompts and the earn-or-pay bar
route: /dashboard/ads
keywords: [ads overview, buying-intent prompts, covered prompts, earn or pay bar, earned, neither, open prompts, ai-assisted signups, cost per ai-assisted signup, not analysed]
synonyms: [ads summary, ads kpis, earned vs paid, buying prompts, cost per signup]
plan: all
updated: 2026-11-16
last_checked: 2026-11-16
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_overview.tsx, server/src/lib/ads/overview.js, server/src/lib/ads/intent.js, server/src/config/ads.js]
---
The **Overview** tab of **Ads** sums up your brand's buying-intent prompts for the period you pick beside the tabs: **7d**, **30d** (the default) or **90d**. It shows how many you cover in AI answers and how many are still open.

## Buying-intent prompts

A buying-intent prompt is a tracked prompt where people compare and choose. By default, it's a prompt whose intent is **Comparison**, **Best / Top**, **vs. / Review** or **Recommendation**, as the **Insights** tab of **Prompts** shows it. Admins can move this line with **Thresholds** on **Opportunities**.

A prompt whose intent isn't analysed yet is never guessed. **Not analysed**, under the count, says how many there are and opens the **Insights** tab, where Admins and Managers run the volume analysis.

## Covered (earned or paid)

**Covered** is the share of your buying-intent prompts where AI answers cite one of your pages during the period. Paid prompts would count too, but who pays isn't measured yet, so the line under it says the count is earned only.

## What isn't measured yet

Two cards say **Not measured** instead of a number:

- **Paid SoV**: sponsored ads in AI answers aren't captured yet. **Who pays per prompt** opens the **Paid SoV** tab.
- **Cost per AI-assisted signup**: it needs a connected ad account. Under it, you see the period's AI-assisted signups, counted from conversions from AI visits. With those off, it says **AI-assisted signups: not measured**. Admins and Managers turn them on in **Brand Settings › Tracking**.

## The earn-or-pay bar

**Earn or pay** puts each buying-intent prompt in one part, so the parts add up to the total:

- **Earned (cited)**: AI cites one of your pages.
- **Earned + paid** and **Paid only**: these need paid data. Until it's measured, the bar shows only **Earned (cited)** and **Neither**, and says so.
- **Neither**: AI cites no page of yours.

The button under the bar counts the open prompts, such as **See 4 open prompts**, and opens **Opportunities**, where each prompt has its decision.

## On Starter and in the free trial

You see the whole **Overview**. Under the bar, a line says how many more prompts in **Opportunities** are included from the Growth plan.
