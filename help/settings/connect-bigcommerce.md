---
title: Connect a BigCommerce catalog
route: /dashboard/settings/integrations
keywords: [BigCommerce, product catalog, store hash, access token]
synonyms: [import store products, sync product variants]
plan: all
updated: 2026-11-26
last_checked: 2026-11-26
owner: Cihan
app_version: 0.3.0
approved: false
sources: [CONNECTORS.md, server/src/connectors/bigcommerce/index.js]
---

Connect a BigCommerce store to bring its visible products, variants, images and categories into a brand’s product catalog.

## Connect your store

An Ansvisor admin or manager with access to the brand can connect its catalog. Create a store API account in BigCommerce with **Products** set to **read-only**. From its API path, copy the store hash between **/stores/** and the next slash. Keep the access token handy.

In **Settings › Integrations › Product catalog**, select the brand and choose **Connect BigCommerce**. Enter the public storefront address shoppers use, the store hash and the access token. If the sign-in is refused, check that the token belongs to that store and has permission to read products.

## Refresh the catalog

Choose **Sync now** to read the store again. Changes appear on the matching products and variants. Products removed from the store leave the active catalog.
