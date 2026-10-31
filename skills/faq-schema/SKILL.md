---
name: faq-schema
description: "Writes an FAQ block for a page from the questions buyers ask AI engines, with FAQPage schema that matches it word for word. Use when the person asks for an FAQ, FAQ schema, or answers to the questions people ask AI about a page or topic."
license: MIT
metadata:
  title: "FAQ + schema writer"
  category: create
---

# FAQ + schema writer

An FAQ block that answers the questions AI engines search for, and the FAQPage structured data that goes with it.

## When to use

- "Write an FAQ for our pricing page", "Add FAQ schema to this draft", "What questions should this page answer?"
- If the page or topic is unclear, ask which one first.

## What to read

1. `get_fanouts` for the brand, or the topic of the page: the searches the engines run behind its answers. These are the best questions.
2. `get_prompt_insights` or `list_prompts` for the topic: the prompts people ask, and where the demand is.
3. `list_ai_answers` for one or two of those prompts: what AI says now, and what it gets wrong or leaves out.
4. `get_draft` when the person names a draft: its passages, so the FAQ doesn't repeat them.

## How to write

- Pick 5 to 8 questions. Merge near-duplicates, and phrase each the way a buyer would ask it.
- Answer each in 40 to 80 words. The first sentence answers the question on its own; the rest adds detail.
- Use only facts from the person's messages, the brand's own pages read in this chat, or the draft. Any other fact is a [placeholder], such as [plan limits] or [support hours].
- The schema repeats each question and answer exactly as the visible FAQ says them.

## Output

1. The FAQ as HTML: a heading, then each question as a subheading with its answer.
2. The FAQPage structured data as JSON-LD, in a code block, ready to paste in the page's head.
3. One line on where the questions came from (fan-outs, prompts).

When the person wants it kept, save it as a draft with `create_draft`; the app asks them first when it should.

## Don't

- No tracking numbers (visibility, share of voice, rankings) in the FAQ: it is public content.
- Don't invent prices, figures, customers or awards.
- Don't mark up questions and answers that aren't visible on the page.
