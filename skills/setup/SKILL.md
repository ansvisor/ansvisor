---
name: setup
description: "Walks through the open Getting started steps, then recommends 3 to 5 agents for your site type and role."
license: MIT
metadata:
  title: "Setup guide"
  filters: "visibility"
---

# Setup guide

The Onboarding & Help agent's skill: where the brand stands in Getting started, the steps still open with a link to each page, then 3 to 5 ready-to-use agents that fit the brand's site type and the person's work areas, each linked to its card in Agent Center › Ready to use. Turning an agent on stays the person's click.

## When to use

- "Help me set up", "What should I do next in Ansvisor?", "Which agents should I use?"
- On a new brand, or for a new member, on day one.
- For one step the person names ("Connect Search Console"), do only that step, then the agents.

## What to read

1. `get_onboarding_progress`: the Getting started steps, done and open, in stage order.
2. `list_connections`, only when an open step connects something: whether Search Console and Analytics are connected for the brand.
3. `list_ready_agents`: the ready-to-use agents to recommend, those made for the brand's site type or the person's work areas first, each with why it fits and the link to its card.
4. `open_page` for the page of each open step you list.
5. `list_brands` only when no brand is selected.

## Questions

- When the workspace has two brands or more and none is selected, ask which brand to set up first.
- Nothing else: the progress and the agents' list answer the rest.

## Steps

1. Say where the brand stands in one line: how many Getting started steps are done, out of how many.
2. List the open steps in stage order, five at most. For each: what it needs, why it matters for AI answers, and its page, linked with `open_page`.
3. For anything the person connects themselves (Search Console, Analytics, the AI Traffic snippet), give the short steps they take.
4. When every step is done, say so in one line.
5. Then recommend the agents `list_ready_agents` gives, in its order: 3 to 5. For each, its name, what it does in one line, why it fits (made for the brand's site type, for one of the person's work areas, or useful for every brand), and a link to its card with its `href`.
6. Say how to turn one on: **Use this agent** on its card opens it filled in, and nothing runs until they click **Turn on**.

## Output

Text: the one-line status, the open steps as a numbered list, then "Agents for you" with the recommended agents as a list.

## Next moves

The next open step, such as "Add 3 competitors", and a how-to question about Ansvisor, such as "How do I connect Google Search Console?": Chat answers those from Help.

## Don't

- Never create, turn on or run an agent: the person picks one in Agent Center and turns it on.
- Recommend only the agents `list_ready_agents` gives, never one marked Soon.
- Never mark a Getting started step done or skip one: it completes through its own check.
- Add competitors, topics or prompts only with the tools that do it, and the app asks the person first.
