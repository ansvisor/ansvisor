---
name: plan
description: "Plans your next 30 days from your brand's data, and adds its actions to Action Center once you confirm."
license: MIT
metadata:
  title: "30-day plan"
  filters: "visibility content"
---

# 30-day plan

Build a four-week plan that raises the brand's visibility in AI answers, from its own data, and add the plan's actions to the Action Center so each one is real and opens from the answer.

## When to use

- "Make me a 30-day plan", "A task list for this month that raises our visibility", "What should we do in the next four weeks?"
- To work on actions that already exist, the Complete this week's tasks skill fits better.

## What to read

Every read covers the person's date range: Chat asks for it before the first read and keeps it. A period named in the message is used for this plan only.

1. `get_visibility_summary`: the brand's average visibility, mentions, citations and top competitors.
2. `get_prompt_performance`: each prompt's visibility, mentions and citations, to find the low and falling ones; `list_prompts` for their topics.
3. `get_competitor_comparison`: who leads, by how much, and on which platforms.
4. `list_content_opportunities`: the prompts where the brand loses visibility and the page that would win them, highest score first.
5. `list_action_center_tasks`, the new and in-progress actions: what is already planned. `get_action` for one whose scope isn't clear from its title.

## Steps

1. Find the gaps: prompts with low or falling visibility, the top opportunities, prompts and platforms where a competitor leads, and pages that lost citations.
2. Leave out anything an open action already covers (the same prompts or pages, for the same goal): name that action, as AC-n, in the plan instead.
3. Choose 8 to 12 new actions in all: the most visibility for the least effort first. For each: a title that names its prompt or page, its category (growth, protect, recover, fix, compete), why, with the numbers it comes from, its effort (Small: under 2 hours, Medium: about half a day, Large: a day or more), the prompts and pages it covers, and 1 to 3 tasks, each with its exact page or where it is done, and Done when.
4. Spread them over four weeks, at most 3 a week: fixes and quick wins in week 1, then the pages and content that win prompts, and in week 4 the follow-ups and a check of what moved.
5. Show the plan, then ask once, as one question with options: add the new actions to the Action Center now (recommended), or change the plan first. When the person asks for changes, show the changed plan and ask once again.
6. When the person says yes, call `create_action` once for each new action, in week order. The app shows its own card where the person's mode needs one; an action they decline is left out. In an agent's run nobody is there to ask: call the tool anyway, and the app holds each action for approval where the agent's mode needs it.
7. When `create_action` answers `duplicate`, nothing was made: link the action it names (AC-n) in that action's place, and never create it anyway.

## Output

1. The date range read, in one line.
2. One table for each week: Action (AC-n, or "not added" with the reason), Why, Effort, Prompts and pages.
3. Already open: each open action the plan builds on, as AC-n, with what it covers.
4. One line, "What to do first": the first action, and its first task.

## Don't

- Never create an action before the person says yes, and never more than 12.
- Never complete, dismiss or edit an action or a task, and never set a due date or an assignee: the person does that in the Action Center.
- Don't invent numbers: every figure comes from a read above.
- Never promise that the plan will raise visibility by an amount or by a date; say what to watch after each week.
