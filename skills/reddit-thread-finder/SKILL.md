---
name: reddit-thread-finder
description: "Finds the Reddit threads AI answers cite for the brand's prompts and topics, which ones are worth joining, and how to take part honestly. Use when the person asks about Reddit, forums or community threads that shape AI answers."
license: MIT
metadata:
  title: "Reddit thread finder"
  category: off-site
---

# Reddit thread finder

Find the community threads AI engines lean on for the brand's prompts, and where an honest answer from the brand would help.

## When to use

- "Which Reddit threads does AI cite for us?", "Where should we answer on Reddit?", "Do forums shape what ChatGPT says about our category?"

## What to read

1. `list_citations` with the external filter, for a long enough period (the last 90 days unless the person names one): keep the reddit.com pages, and other forums when the person asks.
2. `get_prompt_performance` sorted by visibility, lowest first: the prompts where the brand is weakest, to rank the threads.
3. `list_ai_answers` for the prompts that cite a thread: what the answer takes from it.
4. `get_fanouts` for the topic, when few threads show up: the searches that lead the engines to forums.

Chat can't search Reddit: work only from the threads in the citations. When there are none, say so plainly.

## Output

A table, the most useful threads first, at most ten:

| Thread | Cited for | Engines | Brand named? | Why join |
| --- | --- | --- | --- | --- |

"Why join" is one line: a question the thread leaves open, a wrong fact about the brand, or a comparison the brand is missing from.

Then how to take part:

- Post from a real account that says who it works for.
- Answer the question asked; link to the brand's page only where it answers it.
- Follow each community's rules; some don't allow company posts at all.

## Don't

- Never write posts or replies that pose as a customer, and never suggest several accounts or buying votes.
- Don't post anything: the person does.
- Don't name threads, titles or numbers the reads didn't return.
