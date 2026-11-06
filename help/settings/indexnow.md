---
title: Tell search engines when a page goes live (IndexNow)
route: /dashboard/settings/integrations
keywords: [indexnow, bing, ping search engines, index a new page, announce page, copilot, faster indexing]
synonyms: [submit url to bing, tell google about a page, get a page indexed, crawl my new page]
plan: all
updated: 2026-11-06
last_checked: 2026-11-06
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/send-to-cms.mdx]
---
**IndexNow** tells Bing, Yandex and other search engines that share it when a page of your brand goes live through **Send to CMS**, so they don't wait for their next crawl. It is free, uses no AI and never holds up a publish.

## Set it up

In **Settings › Integrations**, find **IndexNow** under the CMS cards, for the brand open now, and click **Set up IndexNow**. Admins and managers can do this.

1. Ansvisor makes a key. Make a text file named after it, ending in .txt, that holds only the key. **Copy key** puts it on your clipboard.
2. Put the file at your site's root, on the domain the card shows, so it opens at the address under the key.
3. Click **Check**. When Ansvisor finds the file, the card says **On**.

## What happens next

Each page that goes live through Send to CMS on that domain is announced once. A page on another domain or subdomain isn't. If an announcement fails, the page is still published.

Webflow and Wix can't put a file at your site's root, so on a brand that uses them, the card says so and IndexNow stays off. **Turn off** stops announcing pages; you can then remove the file from your site.
