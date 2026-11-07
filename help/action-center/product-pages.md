---
title: Optimize the product pages AI asks about
route: /dashboard/action-center/actions
keywords: [product pages, optimize product pages, online store, shopping cards, group size, pages at a time, ga item revenue]
synonyms: [improve product pages, product page seo for ai, which products to optimize, ecommerce pages, store pages]
plan: all
updated: 2026-11-07
last_checked: 2026-11-07
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/action-center.mdx]
---
On an online store, Ansvisor picks the product pages most worth improving for AI shopping answers and opens an **Optimize the product pages AI asks about** action for them. It needs your site type set to an online store and a product catalog.

## Which products

Ansvisor looks at the last 30 days:

- the AI shopping cards that showed the product for your prompts, weighted by how often those prompts are searched;
- its orders and AI visits, and its revenue in Google Analytics, matched to your catalog by SKU, GTIN or product name;
- whether it's in stock and has a live page.

A page whose draft you marked ready or published in the last 30 days waits for a later action.

## A few pages at a time

The action keeps up to ten products, best first. Under **Pages at a time**, pick **3 pages**, **5 pages** or **10 pages** (5 to start). The action works on that many: its title, its pages and **Start now** follow. The rest are listed under **Next**.

## The work

**Start now** opens each page of the group in the Content Editor as an optimize draft. When you publish the pages, the action measures them as AI answers run again. Nothing changes on your site until you publish.
