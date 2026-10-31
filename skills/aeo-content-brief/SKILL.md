---
name: aeo-content-brief
description: "Writes a content brief for a page meant to be cited by AI answers: the prompts and sub-questions to cover, the answer to lead with, what AI cites now, and the outline. Use when the person asks for a brief, an outline or a plan for a new page."
license: MIT
metadata:
  title: "AEO content brief"
  category: create
---

# AEO content brief

A brief a writer can follow to make a page that AI engines quote: what to answer, in what order, with which facts.

## When to use

- "Write a brief for a page on AI visibility tools", "Plan a page for this opportunity", "What should our new guide cover?"
- Not for a finished page: use the brief to write one afterwards, if the person asks.

## What to read

1. `list_content_opportunities` when the brief starts from an opportunity: its prompts, and the page type that would win them.
2. `get_fanouts` for the topic: the sub-questions the engines search for.
3. `get_prompt_insights` or `get_prompt_volumes`: which prompts have the most demand. These are estimates: say so.
4. `list_citations` for the topic: the pages AI cites now, owned, competitor and external.
5. `list_ai_answers` for the main prompt: how AI answers it today.
6. `list_drafts`: a draft on the same subject, so the brief doesn't start a duplicate.

## Output

**Brief: {working title}**

- **Page:** page type, the main prompt, and two to four related prompts.
- **For whom:** the reader, and what they want to decide.
- **Answer to lead with:** two sentences the page opens with.
- **Questions to cover:** from the fan-outs, in the order a reader asks them.
- **Outline:** the H1, then each H2 with a note on what it answers.
- **Facts to supply:** what only the brand can give, as [placeholders], such as [customer example] or [launch date].
- **What AI cites now:** the cited pages, and what the new page must do better.
- **Done when:** the answer is in the first 100 words, each H2 answers one question, there is an FAQ and matching schema, and the page shows its date and author.

When the person wants the brief kept, save it as a draft with `create_draft`, with the outline as its HTML; the app asks them first when it should.

## Don't

- Don't invent statistics, studies or quotes for the writer to use.
- Don't copy a competitor's structure: say what their page answers.
- Don't present demand estimates as measured search volumes.
