---
name: fix-wrong-ai-claims
description: "Finds AI answers that state wrong facts about the brand, checks each claim against facts the person confirms, and drafts fixes: clearer passages for the brand's own pages and a list of the third-party pages the engines rely on. Use when the person says AI gets something wrong about them."
license: MIT
metadata:
  title: "Fix wrong AI claims"
  category: off-site
---

# Fix wrong AI claims

Find what AI engines get wrong about the brand, where they got it from, and what to change so the next answers are right.

## When to use

- "ChatGPT says we don't have an API", "AI keeps calling us a free tool", "Find wrong claims about us."
- When the person names the wrong claim, start from it; otherwise look for claims first.

## What to read

1. `list_mentions`, with a search for the subject when the person names one: the answers naming the brand, and their excerpts.
2. `get_mention` for each answer that looks wrong: its full text and the pages it cites.
3. `list_ai_answers` for the prompts where the claim shows: whether every engine says it, or one.
4. `get_mentions_perception`: what AI associates with the brand, to spot a wrong idea that keeps coming back.
5. `list_citations` with the external filter: the third-party pages behind those answers.

## How to work

- List each claim once, with the engines and prompts that make it.
- You don't decide what is true. Check each claim against the person's own words or the brand's pages read in this chat; when neither says, ask the person, with the claim quoted.
- For a confirmed wrong claim, find its likely source: a cited page that says it, or no source at all.

## Output

1. A table: Claim, Engines, Prompts, Cited source, What's true (as the person confirmed), Fix.
2. Fixes on the brand's own pages: a short, dated passage that states the right fact plainly, ready to paste. When the person wants it kept, save it as a draft with `create_draft`; the app asks them first when it should.
3. Third-party pages: each page, what it says, and what to ask its owner to correct. The person reaches out; Chat sends nothing.
4. When to check again: after the next tracking runs, with the same prompts.

## Don't

- Never state what is true about the brand from your own knowledge.
- Don't invent contacts, names or addresses for outreach.
- Don't promise the engines will change their answers, or when.
