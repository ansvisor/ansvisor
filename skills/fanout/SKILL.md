---
name: fanout
description: "Finds the sub-questions AI searches where you're missing, and drafts answer-first sections for them."
license: MIT
metadata:
  title: "Fan-out gaps"
  filters: "content visibility"
---

# Fan-out gaps

Before an AI engine answers a tracked prompt, it searches a few sub-questions: its query fan-out. Where none of the answers that searched a sub-question named the brand or cited its site, AI found nothing of the brand's to use. This skill finds those sub-questions and drafts an answer-first section or FAQ entry for each, in the words the engines searched.

## When to use

- "Which questions does AI search where we're missing?", "Fill our fan-out gaps", "Draft answers for the sub-questions AI looks up."
- For an FAQ block from a page's most searched fan-outs, whether the brand is missing or not, the FAQ from fan-outs skill fits better; to rewrite a whole page answer-first, the Answer-first rewrite skill.

## What to read

1. `get_fanout_gaps` for the last 30 days, or the period the person names: the sub-questions no answer named the brand in, the most searched first, with the engines that searched each, the tracked prompts behind it and the competitors named instead.
2. `list_ai_answers` for the tracked prompt behind the top one or two gaps: what the engines answer now, and the pages they cite.
3. `get_brand_facts`: the brand's approved facts, the only facts an answer may state besides the person's own.
4. `list_drafts`, and `get_draft` for a draft on the same topic: so a section isn't written twice.

## Steps

1. Take the most searched gaps, or only the topic the person names. Leave out a sub-question searched only once: it may be noise. Work on five at most in one run, and say how many are left.
2. Merge sub-questions that ask the same thing in other words: one answer each.
3. Leave out one the brand can't answer truthfully from its facts, such as a competitor's own product or a feature it doesn't have, and say why in one line.
4. For each, say where its answer belongs: a section of the page the tracked prompt is about, an FAQ entry, or a page of its own when nothing fits.
5. Write it answer-first: a heading in the words the engines searched, then one or two sentences, 50 words or fewer, that answer it on their own, then the detail. A fact that isn't in the approved facts or the person's messages is a [placeholder], such as [shipping cost] or [delivery days].
6. Save the answers with `create_draft`: one draft for the gaps behind one tracked prompt, started from that prompt (source kind prompt, its id), two drafts at most in one run. The app asks the person first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Output

1. A table: Sub-question, Engines, Times searched, Named instead, Where the answer goes.
2. Each answer-first section, ready to paste, with its [placeholders] listed under it.
3. When to check again: after the next tracking runs, whether the answers that search these sub-questions name the brand.

## Don't

- Never make up a fact, figure, price, customer or quote: approved brand facts and the person's own words only.
- Never say a section will get the brand named or cited.
- No tracking numbers (times searched, competitors named) in the drafted text: it is public content.
- Don't add prompts or publish: sending a draft to the CMS and publishing it are the person's, in the Content Library.
