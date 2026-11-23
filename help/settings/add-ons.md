---
title: Add-ons: extra tracking, brands, AI top-ups and packs
route: /dashboard/settings/billing
keywords: [add-ons, extra tracking, extra brands, AI top-up, more prompts, AI credits, buy credits, storage pack, extra storage, AI limit used up, get more, storage full]
synonyms: [add more prompts, track more prompts, add a brand, more brands, get more AI usage, top up credits, more storage, buy more AI, credit pack]
plan: starter
updated: 2026-11-21
last_checked: 2026-11-21
owner: Cihan
app_version: 0.3.0
approved: true
sources: [web/src/components/settings/plan-add-ons-card.tsx, web/src/lib/actions/plan-add-ons.ts, web/src/components/settings/add-ons-card.tsx, web/src/components/ai-usage/get-more.tsx, web/src/lib/actions/add-ons.ts]
---
**Settings › Billing** sells more for your plan. On Growth, **Add more to your plan** adds extra tracking, extra brands and AI usage top-ups, picked together and paid once. **Add-ons** shows AI credit you have left and the packs you bought. Everything is paid with Stripe, added only after the payment goes through, and shown on your invoice.

## Add more to your plan (Growth)

- **Extra tracking:** more prompt locations, tracked on your plan's engines every day. Pick one tier, or **None** to remove it. The largest tiers say **Contact sales**.
- **Extra brands:** each with its own topics, competitors and white-label reports, at a monthly price per brand.
- **AI usage top-up:** one payment that adds AI usage, briefs and opportunities until your plan renews. It doesn't renew, and you can buy another any time.

On a yearly plan, tracking and brands show yearly prices, with 2 months free.

## Review and pay

Pick what you want, then click **Review and pay**. The window shows your new limits, what is **Due today** (the rest of this period for tracking and brands, and a top-up in full) and your total from the next renewal. **Pay** charges the card on file once. A lower tier or fewer brands leaves a credit for your next invoices. You can't go below what you use: pause prompts or remove brands first.

Only admins of an active Growth plan buy. In a free trial, start your plan first; if your plan is set to end, keep it first.

## AI credit packs (no longer sold)

AI credit packs have been replaced by AI usage top-ups. Packs you already bought stay valid until they expire, 12 months from the payment. Their credits are used only once the month's included AI usage is spent, the oldest pack first, so the monthly reset never wipes them. Usage on your own AI keys never touches them. The line **AI credit: … left · expires …** shows what is left and when the oldest pack ends.

## Storage packs

Your storage holds Chat's files and the images you upload or generate in the Content Editor. A storage pack adds a fixed amount of storage every month. It joins your plan's subscription: the rest of the current period is charged at once to the card on file, and it renews with your plan until it is removed. Storage packs need a plan billed monthly. They're sold in the **Get more** window, not in Billing.

## Get more from where a limit shows

You don't have to go to Billing: wherever a limit shows, **Get more AI credits** or **Get more storage** opens the same window. Without the new Chat, **Get more AI usage** on Growth goes to **Add more to your plan** in Billing. It is in the AI usage meter's popover, on the red banner once the month's AI usage is used up, on the Files page's storage meter and its **Storage is full** line, on an output Chat couldn't save to Files, and on an image upload refused because storage is full. When Chat stops at the AI limit, the window opens once by itself.

## What the Get more window shows

The window shows your plan and what the next plan would add, and where the limit stands (for example "AI usage this month: 100% · Growth · resets Nov 1" or "Storage 24.6 of 25 GB"). It has two tabs. On **AI credits**, Growth admins pick a top-up (+5x, +10x or +20x), click **Buy**, then **Pay** to charge the card on file at once; Starter is offered Growth. On **Storage**, pick a pack and click **Continue to payment**, as below.

On Enterprise, the window also has **Use your own key**: on the other plans, Chat runs on the plan's AI limit and credit packs.

## Buy a pack

1. Click **Get more storage**, for example on the Files page's storage meter.
2. On **Storage**, pick a pack. **Most picked** marks the one most workspaces choose.
3. Click **Continue to payment**, then confirm with **Add to plan**.

Once the payment is confirmed, the pack is listed under **Purchases**.

## Who can buy

Only admins buy packs. Everyone else sees the packs and **Ask your Admin**, which sends the request to your workspace's admins. A workspace in its free trial can't buy packs: choose a plan first.

## Purchases and invoices

Admins see **Purchases**: the date, the pack, the price, its status (**Processing**, **Active**, **Used up**, **Expired**, **Ended** or **Refunded**), what is left, and a download for its invoice. Refunds are made by the Ansvisor team; a refund takes back what the pack hasn't used yet.

## What the monthly AI allowance covers

The plan cards in **Settings › Billing** give a rough guide: Starter's monthly AI allowance writes up to 25 new pages or optimizes up to 50 pages, and Growth's up to 125 or 250. The allowance is shared with Chat, agents and the other AI features, so using those leaves fewer pages. Longer pages and a costlier AI model use more of it.
