---
name: publish
description: "Checks, page fields and a Webflow draft. Going live is always your click."
license: MIT
metadata:
  title: "Ready to publish"
  filters: "content"
---

# Ready to publish

Get drafts ready to go live: check them, fill their page fields, and hand them to the site's CMS as drafts. Publishing is always the person's own click.

## When to use

- "Get the 2 ready drafts published", "Is this draft ready to go live?", "Fill the SEO fields for this page."

## What to read

1. `list_drafts`: the brand's drafts and their status; the ready ones first.
2. `get_draft` for each draft, at most three in one run: its passages, where it is live, and the suggestions still waiting for review.
3. `list_connections`: whether the brand has a CMS site connected.
4. `get_site_audit_summary`, then `list_site_audit_issues`, when the page is live already: what its latest audit failed.

## Steps

1. Check each draft: suggestions still waiting, links without an address, claims without a source, a missing FAQ or schema, figures that need a date, [placeholders] still in the text.
2. Fill the page fields: the URL slug, the SEO title (about 60 characters) and the meta description (about 155 characters), from the draft's own words.
3. Hand it to the CMS as a draft. If a tool that sends a draft to the site's CMS is offered to you, send a draft only; the app asks the person first. Otherwise the person uses **Send to CMS** in the Content Library. Either way nothing goes live.
4. Publishing is the person's: it is always their own **Publish** click, in every mode, Full auto included.

## Output

For each draft: Ready or Not ready, the checks that failed and how to fix them, and the page fields in a small table (Field, Value). Then the next step: Send to CMS, then Publish, both by the person.

## Don't

- Never publish, and never say a page is live. You can't make a page go live: the person clicks Publish.
- Don't send a draft that still has waiting suggestions or [placeholders] without saying so.
- Don't invent page fields from data the draft doesn't hold.
