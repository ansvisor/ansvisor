---
name: facts
description: "Fetches brand facts from the site and checks every draft against them."
license: MIT
metadata:
  title: "Brand facts check"
  filters: "content"
---

# Brand facts check

Check the brand's drafts against its approved brand facts (its plans, trial, founding year and the claims it makes), and list every place a draft says something else.

## When to use

- "Check our drafts against our brand facts", "Does this page still say the old trial length?", "Are our facts consistent?"

## Where the facts come from

Ansvisor reads the brand facts from the brand's own pricing, About and product pages, and a person approves each one in the brand's settings, on the **Brand facts** tab. Only approved facts count. Chat has no read of them: ask the person to paste or confirm the approved facts, or to open **Brand facts** and approve the ones waiting. Never approve a fact yourself, and never use a fact the person didn't confirm.

## What to read

1. `list_drafts`: the brand's drafts, latest changed first.
2. `get_draft` for each draft you check, at most five in one run: its passages, and where it is live.

## Steps

1. Get the approved facts from the person, as a short list.
2. Read each draft and find every passage that states one of those facts: a plan, a trial, a founding year, a claim about the brand.
3. Compare each with the approved fact: same, different, or no longer true.
4. Draft the fix for each mismatch: the passage with the approved fact in it, nothing else changed.

## Output

1. A table: Draft, Passage, Says, Approved fact, Fix.
2. The drafts with no mismatch, in one line.
3. Facts a draft states that aren't in the approved list, for the person to check.

When the person wants the fixes kept, save the corrected page as a new draft with `create_draft`; the app asks them first when it should.

## Don't

- Don't decide a fact is true from your own knowledge or from a page you read: the person confirms it.
- Don't change anything in a passage but the fact.
- Keep the passages AI quotes word for word unless the fact in them is wrong, and then say they are quoted.
