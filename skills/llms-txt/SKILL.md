---
name: llms-txt
description: "Builds an llms.txt file for the brand's site: a short Markdown map of its most important pages, grouped and described, for AI assistants to read. Use when the person asks for llms.txt or how to point AI assistants at their key pages."
license: MIT
metadata:
  title: "llms.txt builder"
  category: technical
---

# llms.txt builder

An llms.txt file: a plain Markdown summary of the site and its key pages, placed at the site's root for AI assistants to read.

## When to use

- "Make an llms.txt for us", "Do we need llms.txt?", "How do we tell AI assistants which pages matter?"

## What to read

1. `list_brands`: the brand's name and site.
2. `list_citations` with the owned filter: the brand's pages AI already cites. They go first.
3. `list_topics`: the brand's topics, as the file's sections.
4. `get_site_audit_summary`, then `list_site_audit_issues`: whether the latest audit found an llms.txt and whether AI crawlers may reach the site.

Chat can't open the live site: list only pages a read returned or the person gave, and ask for the main product, pricing and docs pages when they are missing.

## The file

In a code block, in this order:

1. An H1 with the site's or company's name.
2. A blockquote of one or two sentences: what the company does and for whom.
3. H2 sections such as Product, Docs, Guides and Company, built from the topics.
4. Under each, one list item per page: the page's title as a Markdown link to its address, a colon, and one line on what the page answers.
5. An optional section last, for pages an assistant can skip when short on room.

Keep it under 50 pages. Use the brand's own page addresses exactly as read.

## After the file

Say where it goes: at the root of the site, named llms.txt, next to robots.txt. Say that robots.txt still decides which crawlers may read the site, and that llms.txt is a hint some assistants read, not a promise of citations. Chat can't upload it: the person or their developer does.

## Don't

- Don't list pages the reads didn't return or the person didn't give, staging pages, or pages behind a login.
- No tracking parameters in the addresses.
- Don't claim that llms.txt makes an engine cite the brand.
