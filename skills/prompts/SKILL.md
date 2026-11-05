---
name: prompts
description: "Proposes prompts to add and to pause, with the evidence for each. Every change waits for your click."
license: MIT
metadata:
  title: "Prompt portfolio"
  filters: "visibility"
---

# Prompt portfolio

Keeps the brand's tracked prompts on what matters. It proposes prompts to add, from the brand's prompt suggestions, the sub-questions AI engines search and its Search Console queries, and prompts to pause, where nothing moved. Each change is a card the person approves, and the Activity log can undo it.

## When to use

- "Which prompts should we add or pause?", "Clean up our tracked prompts", "We're near our prompt limit: what can go?"
- For what buyers ask AI, grouped by topic, the Buyer questions skill fits better.

## What to read

1. `list_topics`, and `list_prompts` with active ones only: what the brand tracks now, by topic, where and since when.
2. `get_plan_facts`: the plan's limit on tracked prompts, counted once for each location a prompt tracks, across the workspace's brands.
3. `list_prompt_suggestions`: the pending suggestions, each with its topic, reason and source; one from Search Console carries its query, impressions and clicks.
4. `get_fanouts`: the sub-questions engines searched behind the brand's answers, how often, and whether each is tracked.
5. `get_gsc_queries`: the brand's Search Console queries with their clicks, impressions and position, now and before, or that Search Console isn't connected.
6. `get_prompt_performance` for the last 28 days and for the 28 days before, lowest visibility first, 50 prompts at most: each prompt's mentions and citations in each period.
7. `get_prompt_volumes`: each prompt's estimated searches a month, where known.

## Steps

### Prompts to add

1. Gather candidates: the pending suggestions, the sub-questions engines searched twice or more that aren't tracked, and Search Console queries with impressions that ask what a buyer would ask an AI engine.
2. Leave out what a tracked prompt already asks in other words, queries with the brand's own name or that look for one page (a login, a contact page, one product), and anything outside the brand's topics.
3. Write each as a person would ask an AI engine, keeping the query's meaning, under the brand's topic it belongs to.
4. Rank them by their evidence: Search Console impressions, times the engines searched it, the suggestion's reason. Propose ten at most.

### Prompts to pause

5. Propose pausing a prompt only when all of these hold: it has been tracked for 8 weeks or more; in both periods its answers neither named nor cited the brand (mentions and citations 0); and its searches a month are unknown or among the brand's lowest. A prompt the brand appeared on, or one tracked less than 8 weeks, stays.
6. Out of scope is the person's call, never yours: a prompt is out of scope only when the person said so, in this chat or the agent's instructions (a topic, product, market or language they no longer cover). A prompt that only looks off-topic to you goes under "Worth a look", with no change proposed.
7. Propose ten at most, the longest tracked first.

### Making the changes

8. When the additions would take the workspace past its limit, say so, and propose fewer, or the pauses first.
9. Ask for the additions with `add_prompts`, one call per topic, and for the pauses with `pause_prompts`, in one call. The app shows each as a card and changes nothing until the person approves it. In an agent's run nobody is there to ask: call the tools anyway, and the app holds each change for approval. Don't ask again for a change the person declined.

## Output

1. "To add": a table: Prompt, Topic, Evidence (its source and numbers), Why it matters.
2. "To pause": a table: Prompt, Tracked since, Mentions and citations in both periods, Searches a month, Why.
3. "Worth a look": prompts that may be out of scope, each with the reason, for the person to decide.
4. The tracking budget: the brand's active prompts and their locations now and after the changes, and the plan's limit for the workspace.
5. One line on Undo: each addition and pause is in the Activity log with Undo, and a paused prompt keeps its history.

## Don't

- Never add or pause a prompt any other way than with its card.
- Don't add topics or dismiss suggestions: list them for the person instead.
- Never make up a volume or a Search Console number: write "unknown" where none is known.
- Never promise that a new prompt will show the brand in AI answers.
