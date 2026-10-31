---
name: share-of-voice-report
description: "Builds a share-of-voice report: the brand against its tracked competitors across AI engines, by platform and topic, with the change against the period before. Use when the person asks how they compare with competitors or wants a share-of-voice table."
license: MIT
metadata:
  title: "Share of voice report"
  category: analyze
---

# Share of voice report

An internal report on how often AI answers pick the brand compared with its competitors, and where that is changing.

## When to use

- "What's our share of voice?", "How do we compare with our competitors on AI?", "Who is winning on Gemini?"
- Not for one competitor's single prompt: answer that from the prompt's answers.

## What to read

1. `get_competitor_comparison` for the period the person asks about (the last 30 days by default) and for the period before it: share of voice, visibility, mentions and citations, per platform.
2. `list_competitors` only when the person asks about a competitor that may not be tracked.
3. `get_mention_competitors`: how often answers name each competitor, and how often alongside the brand.
4. When topics matter, `list_topics`, then `get_competitor_comparison` for the two or three biggest topics.

## Output

1. One headline sentence: the brand's share of voice, its change, and its place among the tracked competitors.
2. A table, the brand first, then competitors by share of voice:

| | Share of voice | Change | Visibility | Mentions | Citations |
| --- | --- | --- | --- | --- | --- |

3. Platforms: where the brand leads and where it trails most, one line each.
4. Topics, when read: the topic with the biggest gap.
5. Two or three takeaways, each tied to a number above, and one next step Ansvisor can take.

Say the period and platforms the numbers cover. When mentions are few, say the sample is small.

## Don't

- This is an internal report: keep it truthful, drops included. Don't put these numbers in public content unless the person asks for that.
- Don't rank companies that aren't tracked competitors, and don't guess their numbers.
- Never say a change was caused by something; say what moved and when.
