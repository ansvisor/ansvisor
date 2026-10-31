---
name: answer-first-rewrite
description: "Rewrites a page or passage so it answers the question in its first sentences, in short self-contained sections that AI engines can quote. Use when the person asks to make content more quotable, answer-first, or better for AI answers."
license: MIT
metadata:
  title: "Answer-first rewrite"
  category: optimize
---

# Answer-first rewrite

Turn a passage that warms up slowly into one that answers first, so an AI engine can lift it as it is.

## When to use

- "Make this section answer-first", "Rewrite our intro so AI quotes it", "Why doesn't AI quote this page?"
- For a whole page, work section by section, the opening first.

## What to read

1. `get_draft` when the person names a draft: its passages, and which ones AI quotes now (locked).
2. `list_prompts` or `get_fanouts` for the page's topic: the questions each section should answer.
3. When a live page is named, `get_site_audit_summary` and `list_site_audit_issues` for its latest audit: the direct-answer and bottom-line-up-front checks.

If the person pasted the text, work from it and read nothing else unless needed.

## How to rewrite

- The first one or two sentences answer the question on their own, in 50 words or fewer. Detail, reasons and caveats come after.
- One question per section; its heading says the question or its answer.
- Define a term where it is first used, in the same sentence.
- Steps as a numbered list, options as a table.
- Keep every fact, figure and claim exactly as the source has it. A passage AI quotes now stays word for word.
- Keep the brand's voice: rewrite the order, not the personality.

## Output

For each passage: **Before**, **After**, and one line on what changed. Then the full rewritten text in one block, ready to paste. When the person wants it kept, save it as a new draft with `create_draft`; the app asks them first when it should.

## Don't

- Don't add facts, figures or promises that weren't in the text.
- Don't shorten an answer until it is no longer true.
- Don't touch locked passages without saying so.
