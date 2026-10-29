---
title: What visibility, position, mentions and citations mean
route: /dashboard/insights
keywords: [visibility score, position, mentions, citations, performance, measured metrics]
synonyms: [metrics explained, what is visibility, ranking in AI answers, why is my score zero]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/answer-engine-insights.mdx, docs/guides/prompts.mdx, docs/guides/add-your-first-brand.mdx]
---
Ansvisor describes how AI answers treat your brand with a few metrics: visibility, position, mentions and citations. They are counted from real AI answers, not estimated, so they never carry an **Estimate** badge.

## Read your visibility score

Visibility is your brand's score on the **Brand Visibility** page, and a column in **Tracked Prompts**. A rough guide:

- **Under 15**: cold start. AI engines barely know the brand on these prompts.
- **15 to 35**: emerging presence. AI sometimes cites you, but competitors dominate.
- **35 to 60**: established. You're reliably cited; focus on the platforms or topics still trailing.
- **Over 60**: category leader. Your job is defending your place against new entrants.

The right threshold depends on how competitive the category is: in a crowded category, 20 can already be leadership.

## Watch the change, not the number

Don't fixate on the absolute number; watch how it moves. A brand growing from 18 to 24 in a quarter is healthier than one stuck at 50.

A score of 0 doesn't mean something is broken. New, niche or B2B brands often start at 0 on most prompts. AI engines need either plenty of training data that mentions your brand or live citations from trusted sources, and the score stays at 0 only while both are missing.

## Position and Performance

Position is where your brand is named among the brands an AI answer lists; named earlier is better. The **Performance** filter in **Tracked Prompts** groups prompts by it:

- **Best**: named in the first third of the brands listed.
- **Good**: in the middle third.
- **Late**: in the last third.
- **Missing**: named in fewer than half the answers.

The dots in the **Positions** column show each platform on its own.

## Mentions and citations

A mention is an AI answer naming your brand. Mention detection ignores upper and lower case, but suggestions copy your spelling, so name the brand as it's named in the wild.

A citation is a source page that comes with an AI answer. The **Citations** page shows which third-party pages AI engines trust to talk about your brand.

## Prompts that skew your metrics

Prompts that include your brand name almost always score high, because the AI obviously talks about you when asked. They don't measure how AI engines discover you on their own, and they distort your averages, so keep tracked prompts free of your brand name.
