---
title: Your first results after brand setup
route: /dashboard/insights
keywords: [first results, after onboarding, first run, first tracking, visibility zero, brand name prompts, tracking snippet]
synonyms: [no data yet, empty dashboard, why is my score zero, what happens next, how long until results]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/add-your-first-brand.mdx]
---
When you finish setting up a brand, the first round of questions to the AI engines starts on its own and the dashboard opens. On a self-hosted install it starts right away. On the cloud it starts after the plan and checkout step: while a free trial is on offer, that step starts the trial, and without one your plan starts the same day.

## How long the first run takes

The first run can take anywhere from a few minutes to one or two hours at busy times. **Brand Visibility** shows that the first tracking is in progress, and fills in with your results as they come back.

You can leave the page: the run keeps going in the background.

## Where results appear first

While you wait:

- **Brand Visibility** fills in with your first results.
- **Citations** fills in with the addresses of the pages AI answers cite.
- **Prompt Suggestions**, on the **Prompts** page, offers prompt ideas to add to tracking.

## Add another brand

To add another brand, pick **Add Brand** in the brand switcher. It walks through the same first five steps as your first brand: brand basics, region and language, topics, prompts and competitors. Its first run starts when you finish. Your plan sets how many brands you can have.

## Add the tracking snippet

Setup doesn't include the tracking snippet. It's an optional step you do separately for **AI Referral Traffic**: real visits that arrive on your site from AI answer engines.

1. Pick **AI Referral Traffic** in the sidebar. Until the snippet sends its first visit, the code is shown at the top of the page. After that, **Code** on the **Tracking snippet** card shows it again.
2. Copy the snippet.
3. Paste it into the head section of your site's pages, just before the head closes. On WordPress, use a header injection plugin; on a static site, edit your template.

Once the snippet sends a visit, the **Tracking snippet** card shows it as active, with the time of the last visit.

## My visibility score is 0

Probably nothing is broken. New, niche or B2B brands often start at 0 on most prompts. AI engines need either plenty of training data that mentions your brand, or live citations from trusted sources. The score stays at 0 only while both are missing, and that is exactly what working on your AI visibility changes.

## Prompts that include my brand name

Remove them. A question that asks about your brand by name almost always scores high, because the AI obviously talks about you when asked. Such prompts don't measure how AI engines discover you on their own, and they distort your averages. Keep your tracked prompts free of your brand name.

## Competitors I've never heard of

Unknown brands in AI answers are useful: they're the alternatives people see when you aren't cited. Add the most-mentioned ones to your competitors to track them properly.

## An AI platform is missing

Your plan sets which AI platforms your prompts are asked on. A self-hosted install runs every platform. On the cloud, some platforms come only with the higher plans.

## Add more topics and prompts later

You can add more at any time. On the **Topics** tab of the **Prompts** page, admins and managers add topics with **Add Topic** or from the **Topic Suggestions** card. **Prompt Suggestions** offers new prompts to track. New prompts run with the next daily run.
