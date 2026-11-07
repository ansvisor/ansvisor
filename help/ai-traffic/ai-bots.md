---
title: See which AI bots read your site
route: /dashboard/traffic
keywords: [ai bots, crawlers, gptbot, claudebot, perplexitybot, cloudflare, vercel, access log, log file, webhook, nginx, apache]
synonyms: [bot logs, ai crawlers, who crawls my site, bot traffic, upload server logs, log shipper]
plan: growth
updated: 2026-11-06
last_checked: 2026-11-06
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/ai-traffic-analytics.mdx]
---
The **AI bots reading your site** section of **AI Traffic Analytics** shows which AI bots read your pages, from your own Cloudflare, Vercel or any server's logs. Only verified bots count: the bot's name and its operator's published addresses must both match. Today that's the bots of OpenAI, Anthropic and Perplexity.

## What the section shows

- **By bot type**: hits, pages read and last seen for **Training**, **Search index** and **User fetch**, with the bots under each.
- **Pages AI bots read**: hits per page, and when each type last read it.
- **The search-bot alert**: pages AI answers cited in the last 30 days that no AI search bot read in that time. It starts 30 days after the first AI-bot request, and pauses when the bot data doesn't cover the last 30 days or the month's cap was reached.

## Connect AI bots

Click **Connect** on the **AI bots** card in the Data sources strip, and choose how your site sends AI-bot requests: **Cloudflare Worker** (recommended), **Cloudflare Logpush**, **Vercel Drain** (Vercel Pro and Enterprise only) or **Any server (webhook)**. Each option says what it costs on your own bill before you connect, and none of them changes your site's speed. Only admins and managers can connect a source.

Click **Create connection** and follow the numbered steps. Copy the settings right away: the secret in them isn't shown again. If you lose it, revoke the connection and create a new one.

## Send logs from any server

On another server or CDN, choose **Any server (webhook)**. Your log shipper, such as Vector, Fluent Bit or Logstash, sends one request a line, with the fields the setup steps list and show in an example line: the user agent, the IP address, the page, the status and the time, and the country if you have it. It sends them to the address shown, with the header that holds the secret. A batch sent twice is read once, and requests older than 7 days aren't counted.

## Upload a log file

Under **Or upload a log file** in the same dialog, click **Upload a log file** and pick an access log: the combined log format (Apache's and nginx's default), or one request a line with the same fields as the webhook. A gzipped file works too. The dialog says how large a file can be and how many lines it may hold.

Ansvisor reads the file once and says how many lines it read, how many AI bot requests it found, and how many lines it left out: older than 7 days, for another site, or without a user agent. The common log format has no user agent, so it shows no bots. A file uploaded again isn't read twice. Only admins and managers can upload.

## Manage connections

**Manage** on the card lists your connections with their last request, lets you **Revoke** one, and shows this month's use. Cloud plans store a monthly number of detailed rows; past it, detailed rows pause until the next month and the totals are still counted. Log files, from Cloudflare Logpush, Vercel Drain, the webhook or an upload, also count against a monthly number of log records; past it, they aren't read until the next month. Only requests to your brand's own domains, or their subdomains, are kept.

## Dates and sample data

Bot counts are kept by UTC day, so the 24-hour range reads yesterday and today (UTC), and All time reads the last 90 days.

On the Starter plan, the section shows sample data with **Upgrade**. With no connection and no AI-bot data yet, it offers **Connect** or **Preview with sample data**.
