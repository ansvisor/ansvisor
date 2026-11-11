---
name: chatgpt-profile
description: "Checks what ChatGPT says about your business against your facts, and prepares your Business Hub corrections and site fixes."
license: MIT
metadata:
  title: "ChatGPT profile check"
  filters: "visibility"
---

# ChatGPT profile check

Compare what ChatGPT says about the business in the brand's tracked answers with what is true, and prepare two things: the corrections to paste into its ChatGPT Business Hub profile, and the fixes for its own site.

## When to use

- "Check my ChatGPT profile", "What does ChatGPT get wrong about our hours?", "Prepare our Business Hub corrections."
- For wrong claims across every engine, not only ChatGPT, the Fix wrong claims about us skill fits better.

## Where the truth comes from

Only these count, in this order:

1. The brand's approved facts, read with `get_brand_facts`. They cover its prices and plans, its trial, its founding year and the claims it makes, and there may be none.
2. What the person says or confirms in this chat.
3. The brand's own pages read in this run with `fetch_page`: quoted word for word, with the page's address, and marked "from your site: confirm before pasting".

Never your own knowledge, and never what ChatGPT says: that is what is being checked. A field none of these gives is a "[confirm: …]" line under Needs your answer, saying what to confirm.

## What to read

1. `list_mentions` for the platform chatgpt-web, from 30 days ago: one page of the answers naming the brand.
2. `get_mention` for at most 8 of those answers: the ones that state facts about the business, such as its hours, address or service area, contact details, prices, policies, products and services.
3. `list_ai_answers` for a prompt the person names.
4. `get_brand_facts`: the approved facts.
5. `fetch_page` for at most 3 pages of the brand's own site: its contact page, its About page, and a pricing, returns, shipping or warranty page. Never another site's page.
6. `list_action_center_tasks`: the brand's actions, to find its ChatGPT Business Hub setup action when it has one.

## Steps

1. List each fact ChatGPT states about the business once, quoted, with the prompt and the date of the answer it is in.
2. Check each against the truth sources above, in their order: it matches, it is wrong, it is missing, or it needs the person's answer.
3. Fill the Business Hub fields: name, category, address or service area, hours, contact details, products and services, and the returns, shipping and warranty policies when the site has them. Write "[confirm: …]" in every field no source gives.
4. Write the site fixes: for each wrong or missing fact, the brand's page that should state it and the passage to add or change, with the true fact and nothing else changed. Save a fix as a draft with `create_draft` only when the person asks; the app asks them first when it should. In an agent's run nobody is there to ask: save it with its tool, and the app holds it for approval where the agent's mode needs it.
5. Offer to add the corrections to the setup action with `attach_to_action` when the brand has one, or to send the site fixes to the Action Center with `create_action` in the fix category, one task for each page.

## Output

1. A table: Field, What ChatGPT says (quoted, with the prompt and date), What's true (and where it comes from), Status (wrong, missing, matches, needs your answer).
2. Paste into Business Hub: one entry for each field, ready to paste, written in the brand's language.
3. Fix on your site: each page and its change.
4. Needs your answer: every "[confirm: …]" line, as questions the person can answer in one reply.
5. When to check again: after the next tracking runs, with the same prompts.

## Don't

- Never state a fact from your own knowledge, or take one from ChatGPT's answer.
- Never fill a field that no source gives.
- Never say Business Hub or ChatGPT will show the correction, or when: OpenAI may fill in or change a profile's fields from other sources.
- Never claim to log in to Business Hub or to change it: the person pastes the corrections there.
