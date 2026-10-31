---
name: citation-gap
description: "Finds the prompts and topics where AI answers cite competitors or other sites but not the brand, and the page that could close each gap. Use when the person asks which sources AI cites instead of them, or where they lose citations."
license: MIT
metadata:
  title: "Citation gap analysis"
  category: analyze
---

# Citation gap analysis

Show where AI engines cite someone else for the brand's prompts, and what the brand would need to be cited there.

## When to use

- "Which sites does AI cite instead of us?", "Where do competitors get cited and we don't?", "Why does ChatGPT cite their blog?"
- For one topic or prompt when the person names one; for the whole brand otherwise.

## What to read

1. `list_citations` with the competitor filter, then with the external filter, for the period: which domains and pages AI answers cite.
2. `list_citations` with the owned filter: the brand's own pages that are cited, to tell "no page" from "a page that isn't cited".
3. `get_prompt_performance` sorted by citations, lowest first: the prompts where the brand is cited least.
4. `list_ai_answers` for the two or three weakest prompts: which pages each answer cites, in its own words.
5. `list_content_opportunities`: gaps Ansvisor already found, with the page that would win them.
6. When a topic matters, `get_fanouts` for it: the searches the engines run behind those answers.

## How to work

For each gap, decide which kind it is:

- **No page:** the brand has nothing on the question.
- **Page not cited:** the brand has a page, but the engines cite another one.
- **Weaker page:** the brand is cited, but less often than a competitor's page on the same prompts.

## Output

A table, the biggest gaps first, at most ten rows:

| Prompt or topic | Cited instead | The brand's page | Gap | Next step |
| --- | --- | --- | --- | --- |

Then the three steps worth doing first, each in one line, such as a new page from a content opportunity, a refresh of the page that isn't cited, or a digital PR target.

## Don't

- Don't suggest copying a competitor's page: say what the cited page answers that the brand's page doesn't.
- Don't name pages, addresses or numbers the reads didn't return.
- Keep the period and platforms of each read in the answer, and say when a list was cut short.
