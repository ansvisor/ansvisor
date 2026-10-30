---
title: Buy AI credits and storage packs
route: /dashboard/settings/billing
keywords: [add-ons, AI credits, buy credits, storage pack, extra storage, AI limit used up]
synonyms: [get more AI usage, top up credits, more storage, buy more AI, credit pack]
plan: starter
updated: 2026-10-30
last_checked: 2026-10-30
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/src/components/settings/add-ons-card.tsx, web/src/lib/actions/add-ons.ts]
---
**Add-ons** in **Settings › Billing** sell extra AI credits and storage for when your plan's monthly limits run out. Packs are paid with Stripe and added to your plan only after the payment goes through, and each one shows on your invoice.

## AI credit packs

Each AI credit pack says what it adds as a share of your plan's monthly AI limit, such as **+20% of the monthly limit** or **+5 monthly limits**, and is valid 12 months from the payment. The monthly limit is your workspace's included AI usage, shared by every seat.

Credits are used only once the month's included AI usage is spent, the oldest pack first, so the monthly reset never wipes them. Usage on your own AI keys never touches them. The line **AI credit: … left · expires …** shows what is left and when the oldest pack ends.

## Storage packs

A storage pack adds a fixed amount of storage every month. It joins your plan's subscription: the rest of the current period is charged at once to the card on file, and it renews with your plan until it is removed. Storage packs need a plan billed monthly.

## Buy a pack

1. Open **Settings › Billing** and find **Add-ons**.
2. Choose **AI credits** or **Storage**, then pick a pack. **Most picked** marks the one most workspaces choose.
3. Click **Continue to payment**. AI credits open Stripe's secure checkout; storage asks you to confirm with **Add to plan**.

Once the payment is confirmed, the pack is listed under **Purchases**.

## Who can buy

Only admins buy packs. Everyone else sees the packs and a line to ask an admin. A workspace in its free trial can't buy packs: choose a plan first.

## Purchases and invoices

Admins see **Purchases**: the date, the pack, the price, its status (**Processing**, **Active**, **Used up**, **Expired**, **Ended** or **Refunded**), what is left, and a download for its invoice. Refunds are made by the Ansvisor team; a refund takes back what the pack hasn't used yet.
