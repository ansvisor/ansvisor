---
name: schema-markup
description: "Writes JSON-LD structured data for a page (Organization, Product, FAQPage, Article, HowTo, BreadcrumbList and others) from the page's own content, ready to paste. Use when the person asks for schema, structured data or rich-result markup."
license: MIT
metadata:
  title: "Schema markup generator"
  category: technical
---

# Schema markup generator

Structured data that tells AI engines and search engines what a page is about, built only from what the page says.

## When to use

- "Write schema for our product page", "Add Organization markup", "Is our structured data right?"
- For an FAQ with its schema, the FAQ + schema writer skill fits better.

## What to read

1. `get_site_audit_summary`, then `list_site_audit_issues` for the page's latest audit: whether JSON-LD is present, valid and of a type that fits the page.
2. `get_draft` when the page is a draft: its content and page type.
3. `list_brands`: the brand's name and site, for Organization markup.

Chat can't open the live page: work from the audit, the draft, or the text the person pastes, and ask for the facts the markup needs.

## How to write

- Pick the type from the page: Organization or WebSite for the home page, Product for a product page, Article or BlogPosting for a post, FAQPage for visible questions and answers, HowTo for steps, BreadcrumbList for the path.
- Fill only properties whose values the page or the person gave. Leave out the rest, or mark them [placeholder] for the person to fill.
- Several types on one page go in one block, under an @graph list.
- Dates in ISO format; addresses absolute.

## Output

The JSON-LD in a code block, for a script tag of type application/ld+json in the page's head. Under it: what each type does, the properties left as [placeholders], and a reminder to test the page with a rich-results test before it goes live.

## Don't

- Don't mark up content that isn't visible on the page.
- No ratings or reviews unless the page shows real ones and the person confirms them.
- Don't add prices, offers or availability unless the page shows them and the person gave the values.
