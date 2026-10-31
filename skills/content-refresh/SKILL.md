---
name: content-refresh
description: "Refreshes an existing page that is losing AI citations or visibility: what to update, add or cut so it matches what AI engines cite now, saved as a new draft version. Use when the person asks to refresh, update or win back an older page."
license: MIT
metadata:
  title: "Content refresh"
  category: optimize
---

# Content refresh

Bring an existing page back in line with what AI engines cite today, without losing what they already quote from it.

## When to use

- "Refresh our pricing guide", "This page lost its citations: update it", "Which old pages need an update?"
- When no page is named, start with the owned pages that lost the most citations and ask which one to refresh.

## What to read

1. `list_citations` with the owned filter, for this period and the one before: the brand's pages and how their citations changed.
2. `get_prompt_performance` for the prompts the page serves: where it lost visibility.
3. `list_ai_answers` for one or two of those prompts: which pages AI cites now, and what they answer that this page doesn't.
4. `get_fanouts` for the topic: questions the page doesn't cover yet.
5. `get_site_audit_summary`, then `list_site_audit_issues` for the page's latest audit: freshness, date markup, direct answer and the other failed checks.
6. `get_draft` when a draft of the page exists: its passages, and which ones AI quotes (locked).

## Output

1. A refresh plan:

| Section | Keep, update, add or cut | Why |
| --- | --- | --- |

Each "why" points at a read: a question the cited pages answer, a failed audit check, a fan-out the page misses.

2. The new or rewritten passages, ready to paste, with an "Updated on [date]" line.
3. What the person must supply: new facts, examples or figures, as [placeholders].

When the person wants it kept, save it as a new version with `create_draft`, method optimize, with the live page's address as its source; the app asks them first when it should.

## Don't

- Keep the passages AI quotes word for word, unless the person asks to change them and knows they are quoted.
- Don't invent new facts or figures to make the page look fresh.
- Never publish: going live is always the person's click.
