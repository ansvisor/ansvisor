---
title: Paid SoV: sponsored ads in AI answers
route: /dashboard/ads
keywords: [paid sov, paid share of voice, sponsored ads, ads in ai answers, who pays, not measured, who pays per prompt]
synonyms: [paid share, sponsored results, competitor ads in chatgpt, ads in ai overviews, rival pays]
plan: growth
updated: 2026-11-16
last_checked: 2026-11-16
owner: Cihan
app_version: 0.3.0
approved: false
todo: complete with PR 17 (the Paid SoV tab's figures, its Overview card and drawer line, Overlap, paid share by platform); until then it describes Not measured only
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_ads-view.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_overview.tsx, server/src/lib/ads/overview.js, server/src/lib/ads/decision.js]
---
**Paid SoV** stands for Paid Share of Voice: your share of the sponsored ads shown in AI answers. Point at the tab's name in **Ads** to see it. Ansvisor doesn't capture sponsored ads in AI answers yet, so everything paid in Ads says **Not measured**. Nothing is estimated.

## What the tab shows today

The **Paid SoV** tab has no figures yet. It says it will show your share of the sponsored ads in AI answers, only on the platforms where Ansvisor can see them.

On Starter and in the free trial, the tab shows what the Growth plan adds, with **Upgrade**.

## Where Ads says Not measured

- **Overview**: the **Paid SoV** card, with **Who pays per prompt** to open this tab. **Covered** counts earned prompts only, and the bar shows only **Earned (cited)** and **Neither**.
- **Opportunities**: a line says who pays on these prompts isn't measured yet, and each drawer's reasons say the same. **What AI answers today** shows no sponsored ads.
- Chat and the **Paid Opportunity** agent say who pays isn't measured, instead of guessing.

## How it affects decisions

While who pays isn't measured, decisions read AI answers and Google searches only. The rule doesn't pick **Pay** by itself: that needs to know a competitor pays on a prompt you lead. Admins and Managers on Growth or above can still set **Pay** on a row.
