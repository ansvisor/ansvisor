---
title: Ad drafts for ChatGPT, Google and Microsoft
route: /dashboard/ads
keywords: [ad drafts, create ad drafts, pay card, claims check, claims checked against your brand facts, approved brand facts, copy ad, edit ad, copy as campaign brief, campaign brief, /ad-drafts, chatgpt ad, google search ad, microsoft ad]
synonyms: [write ads, ad copy, rewrite an ad, ad text, ads from brand facts, character limits not confirmed, ad headlines]
plan: growth
updated: 2026-11-16
last_checked: 2026-11-16
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_pay-card.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_export.tsx, server/src/lib/ads/drafts.js, server/src/lib/ads/claims.js, server/src/config/ad-limits.js, skills/ad-drafts/SKILL.md, web/src/lib/chat/registry/ads-tools.ts]
---
The **Pay · win it now** card in an opportunity's drawer holds the prompt's ad drafts: one for ChatGPT, one for Google and one for Microsoft. It shows for prompts whose decision is **Pay** or **Earn + pay**. The drafts state only facts you approved, and they stay in Ansvisor: nothing is sent to an ad account.

## Create ad drafts

Admins and Managers on Growth or above click **Create ad drafts** on the card, or the drawer's main button. Ansvisor writes the drafts from the prompt, its fan-out queries and keyword seeds, and your approved brand facts. Writing them uses your workspace's monthly AI limit; when that's spent, the card says so.

Everyone who can open the drawer sees the drafts once they're saved. Until then, the card says **No ad drafts for this prompt yet.**

## Approve your brand facts first

Ad drafts only state facts you approved. With none approved, the card asks you to approve them first, with **Open Brand facts**, which opens the **Brand facts** tab of the brand's settings. A fact for one destination, operator or route goes only into ads for prompts that name that place.

If the card says brand facts aren't available here, ad drafts can't be written.

## The claims check

Every draft passes a check before it's saved:

- Each claim rests on a brand fact you approved that is still on your site.
- Every number, such as a price, a trial length or a year, comes from one of those facts.
- Prices, your trial and your founding year match your approved facts.
- No competitor is named. A keyword that names one is dropped.

A draft that fails isn't saved. If none passes, the card says so, and **Try again** writes new ones.

## What each draft shows

- **ChatGPT · contextual**: a headline, a description and **Fits when:**, the moment in a conversation the ad suits.
- **Google · search, eligible for AI Overviews and AI Mode** and **Microsoft · search, eligible for Copilot**: headlines and descriptions.

Under each draft, **Claims checked against your brand facts**. **Character limits not confirmed yet** means its length wasn't checked against the platform's limits: check it on the platform before you use it. With more than one draft, click a channel's name at the top of the card to jump to its draft.

## Copy, edit and brief

- **Copy** copies a draft's text, one headline or description a line.
- **Edit**, for Admins and Managers on Growth or above, opens Chat beside the page with a request to rewrite that draft from your approved facts. It waits in the box for you to change and send.
- **Copy as campaign brief**, at the bottom of the drawer, copies plain text for whoever runs your ads: the prompt, its decision and why, keyword seeds, fan-out queries, each draft, and the facts the drafts use, with their sources.
- **Export this prompt**, for Admins and Managers on Growth or above, saves the prompt and its Google and Microsoft drafts in a file for Google Ads Editor.

## Write or rewrite drafts in Chat

**Ad drafts** (**/ad-drafts**) writes or rewrites a prompt's drafts in Chat, such as "Rewrite the Google ad shorter". It uses only your approved facts and never names a competitor. Before saving, Chat shows each draft's full text on a card, and nothing is saved until you click **Approve**. The same claims check then decides what's kept, and Chat says why any draft wasn't.

Saved drafts show on the prompt's **Pay** card. Only Admins and Managers on Growth or above can save them. Chat never sends, publishes or launches an ad.
