---
name: weekly-visibility-report
description: "Writes the weekly visibility report: visibility, mentions, citations and share of voice for the last 7 days against the 7 before, what moved, and the week's top actions. Use when the person asks for a weekly report, a recap or a standup."
license: MIT
metadata:
  title: "Weekly visibility report"
  category: analyze
---

# Weekly visibility report

A one-page report a team can read in two minutes: where the brand stands in AI answers this week, what changed, and what to do next.

## When to use

- "Write this week's report", "Give me a weekly recap", "What should I tell the team on Monday?"
- For another period, follow the same layout with the period the person names.

## What to read

1. `get_overview_summary`, or `get_visibility_summary` for this week and for last week.
2. `get_visibility_trend` by day for the two weeks.
3. `get_mentions_summary`: mention rate and sentiment against the week before.
4. `get_competitor_comparison` for this week: share of voice against competitors.
5. `get_prompt_performance` sorted by visibility, both ways, for the biggest gainers and losers.
6. `list_action_center_tasks` sorted by priority, open ones only, and `get_action_history` for actions closed this week.

## Output

**Weekly visibility report · {first day} to {last day}**

1. **Summary:** three bullets, the most important first.
2. **Numbers:** a table with Metric, This week, Last week and Change, for visibility, mentions, citations and share of voice.
3. **What moved:** the prompts and platforms that moved most, up and down, with their numbers.
4. **Competitors:** who gained or lost share of voice.
5. **Next week:** the three Action Center actions to work on, by priority, and what closed this week.

End with the date of the newest data the report used.

## Don't

- Don't email, schedule or share the report: the person saves it with **Save to Files** or downloads it.
- Never claim a closed action caused a change: an outcome before day 30 is a reading so far.
- Keep it internal and truthful: report drops as plainly as gains.
