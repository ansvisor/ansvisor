---
title: Connect AI traffic data sources
route: /dashboard/traffic
keywords: [tracking snippet, connect google analytics, connect search console, data sources, install snippet]
synonyms: [set up ai traffic, add tracking code, link analytics, ga4, gsc]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/ai-traffic-analytics.mdx]
---
The **Data sources** strip at the top of **AI Traffic Analytics** shows the four sources the page reads, and each one's state. A section whose source isn't connected stays on the page with a **Needs …** tag and a **Connect** button. Only admins and managers can connect a source.

## What each source adds

- **Tracking snippet**: AI-referred visits, page by page, as they happen.
- **Google Analytics**: AI visits on days the snippet has none, plus engaged visits, key events, revenue and the AI share of all traffic.
- **Google Search Console**: Google clicks, the pages where AI may be taking them, and the Google queries you don't track yet.
- **AI bots**: which AI bots read your pages, from your own Cloudflare or Vercel, on the Growth plan and above.

## Add the tracking snippet

Copy the snippet from the page. It sits at the top until it has sent a visit in the last week; after that, **Code** in the Data sources strip opens it. The page fills in your own address and tracking code, so copy it rather than typing it.

Add it to the head of every page you want to track, your 404 page included, so **Broken AI links** can see visitors who land on a missing page.

## Check that the snippet works

The **Tracking snippet** card reads **Active · last visit …** once the snippet has sent a visit in the last week, otherwise **Not detected**. A visit is stored as soon as an AI-referred visitor lands. Reload the page, or change the range, to see new ones.

## What the snippet collects

The snippet sends nothing for a visitor who didn't come from an AI assistant. For an AI-referred visit it sends the page address, the referrer, the AI source, the browser, its language and screen size, and the page's status as the browser saw it. Ansvisor adds the country.

The snippet sets no cookies, and without conversions it stores nothing in the visitor's browser. The visitor's IP address is never stored.

## Connect Google Analytics and Search Console

Click **Connect** on either card in the Data sources strip and sign in to Google; access is read-only. If the card then reads **Connected · choose a property for this brand**, pick the property under **Manage**, in **Settings › Integrations**. Connections are shared across your organization.

On a self-hosted server, both cards read **Not set up on this server** until the server has its Google connection keys.

## When the first numbers arrive

Google Analytics' first numbers arrive in about 15 minutes; up to 14 months of history can take up to 24 hours. Search Console's can take up to 48 hours, because Google reports about two days late.
