---
name: digital-pr-targets
description: "Lists the third-party sites and pages AI engines cite most for the brand's topics where the brand is missing, as digital PR and outreach targets with an angle for each. Use when the person asks where to get mentioned, which publications to pitch, or how to earn citations off-site."
license: MIT
metadata:
  title: "Digital PR targets"
  category: off-site
---

# Digital PR targets

The outside pages AI engines trust for the brand's topics, ranked by how much a mention there could move its answers.

## When to use

- "Where should we get mentioned?", "Which publications should we pitch?", "How do we earn citations outside our own site?"

## What to read

1. `list_citations` with the external filter: the domains and pages AI answers cite for the brand's prompts.
2. `list_citations` with the competitor filter, and `get_mention_competitors`: where competitors are cited and named.
3. `list_mentions`: whether the brand is already named in answers that cite those pages.
4. `list_content_opportunities` of type earned: off-site opportunities Ansvisor already found.
5. `list_topics`, when the person wants targets for one topic.

## How to rank

A target ranks higher when AI cites it often, for prompts where the brand is weak, and when competitors appear there but the brand doesn't. List pages, review sites, comparison articles and industry publications usually matter more than general news.

## Output

A table, the best targets first, at most ten:

| Site | Kind of page | Cited for | Competitors there | Brand there | Angle |
| --- | --- | --- | --- | --- | --- |

"Angle" is what the brand can offer that site: data, an expert, a product for a list, a correction. What only the brand can supply stays a [placeholder], such as [customer study].

Then the three targets to start with, and what to prepare for each.

## Don't

- Don't invent contacts, names, emails or editors.
- Don't send anything or contact anyone: the person reaches out.
- Don't suggest paying for links, reviews or placements that aren't marked as paid.
