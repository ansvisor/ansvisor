---
title: Prompt Suggestions and Add All
route: /dashboard/prompts/suggestions
keywords: [prompt suggestions, add all, clear all, suggested prompts, source filter, product prompts, catalog suggestions, chatgpt business hub, discovery topics]
synonyms: [prompt ideas, recommended prompts, new prompt ideas, suggest queries]
plan: all
updated: 2026-11-11
last_checked: 2026-11-11
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
**Prompt Suggestions** gives you new prompts to track. Open it with the switch above the filters on the **Prompts** tab of the **Prompts** page. Each refresh writes up to 25 prompt ideas, each with a topic label and a one-line reason.

## Where suggestions come from

Suggestions come from five sources. The sources filter (**All sources**) shows one of them, **From your data** for both Google sources, or **Ansvisor Agents only**:

- **Ansvisor Agents**: written by AI from your brand and tracking data. Each shows an estimated monthly AI volume as a grey range.
- **Google Search Console**: queries people already search, with their impressions over the last 28 days.
- **Google Analytics (GA4)**: pages that earn revenue or conversions, or already get AI visits, with that evidence on the row.
- **Your catalog**: for an online shop with a product catalog, shopping questions about its categories and its top products. The **Shopping** filter lists them.
- **ChatGPT Business Hub**: prompts from the discovery topics you copy from ChatGPT Business Hub, with a filter of their own.

When Search Console or Analytics is connected, a share of each refresh is drawn from their data.

## Shopping suggestions from your catalog

For an online shop with a product catalog, each refresh adds two kinds of shopping suggestions, marked **Your catalog**:

- the questions a shopper asks before buying in a category, using its price band;
- buyer questions about the products that sell most, or that AI shopping answers show most.

Each row names the category or the product it's about; hover **Your catalog** for more. A product one of your prompts already names isn't asked about again.

## Prompts from ChatGPT Business Hub topics

ChatGPT Business Hub shows your business its top discovery topics: what real ChatGPT conversations that cited your site were about. Open Business Hub from ChatGPT and copy them from its Insights.

Then click **From ChatGPT Business Hub** and enter up to five topics. The dialog says how many more prompts your plan can track. Ansvisor writes 2 or 3 prompts for each topic, in your brand's language, and files each under your topic that fits or under the discovery topic. Prompts you already track or that are already suggested are left out.

These suggestions show the **ChatGPT Business Hub** badge. They stay 30 days and aren't replaced by **New**. Tracking one under a discovery topic adds that topic to your topics. Admins and managers can use it; it doesn't count against your AI allowance.

## A brand without topics

Suggestions are written for a brand's topics. If the brand has none, **Generate Suggestions** and **New** ask you to add a topic first and open **Prompts › Topics**, without using any AI.

## Add, dismiss or refresh suggestions

Use **Search prompts…** to narrow the list, **+** to add a suggestion, **×** to dismiss it and **New** to generate a fresh list. **Clear All** asks first, then dismisses every suggestion listed. Admins and managers can add and generate suggestions; analysts can also dismiss them. Those from Search Console or Analytics stay hidden for 30 days once dismissed.

Suggestions expire after 48 hours. Click **New** for fresh ideas, for example after you change your content. Business Hub suggestions stay 30 days and aren't replaced by **New**.

A prompt added from suggestions gets its first results with the next daily run.

## Add every suggestion at once

**Add All** adds every suggestion listed to **Tracked Prompts**, and the added ones leave the list. Like **Clear All**, it acts on what's listed, so a source filter or a search narrows it. Each prompt passes the same plan check as a single **+**.

## When your prompt limit stops Add All

When your plan's prompt limit stops **Add All** partway, an amber note above the list says how many suggestions couldn't be added and how many were added before the limit.

To add the rest, upgrade your plan or ask us to raise your limit, as the note says, or pause as many prompts as the note names and try again. **Go to Tracked Prompts** opens the list where you can pause prompts.

## How AI suggestions are written

The suggestion engine considers five signals:

1. Your brand's name, description and language.
2. Your tracked prompts, so it doesn't repeat them.
3. Your topics, so it reuses their labels when relevant.
4. The competitors named most in your recent tracked AI answers.
5. The estimated volumes of your tracked prompts, so its own estimates stay in proportion.
