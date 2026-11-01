---
title: Check a page's Quality in the Content Editor
route: /dashboard/content/editor
keywords: [quality score, e-e-a-t, trust, readability, hand off, next step, before you publish, page author, qualified reviewer, reviewer, reviewed by]
synonyms: [content quality, quality check, page score, eeat score, ready to publish checklist, content reviewer, regulated page review]
plan: all
updated: 2026-11-01
last_checked: 2026-11-01
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/content-editor.mdx]
---
Quality scores a Content Editor page and lists what would raise it. It's turned on per installation: where it's off, nothing on this page shows. With it on, **Instructions** in the side panel has a third segment, **Quality**, and the header a **Quality** chip with the page's score.

## The scores

Quality scores the page from 0 to 100 on **E-E-A-T**, **Trust** and **Readability**: 80 and up is **Strong**, 60 to 79 **Can improve**, and under 60 **Needs work**. The scores are Ansvisor's estimates from Google's published quality signals, not a Google score.

At the bottom, **Site trust**, out of 5, comes from Site Audit's checks of your site, with **Fix in Site Audit** when some are missing.

## Your to-dos and what would raise it

- **Your to-dos** are what only you can do, such as picking the page's author, adding your own experience, data or an expert's quote, linking the proof for a claim, and filling the placeholders.
- **What would raise it** lists the checks still open, each with the points it would add to a score and, where it has one, a button such as **Show** or **Add source**.

## Hand off

**Hand off** asks the Content Agent to fix the open suggestions in one run, as changes for you to review. Your to-dos stay yours. Each Hand off is kept in the page's History, and it uses your workspace's monthly AI usage.

In **Settings › Content**, admins and managers can have each brand's new pages handed off on their own when they're first opened in the editor.

## Next step

With Quality on, the header shows the page's **Next step**: plan the page, write the first draft or bring in your page, fix its length or open rules, add proof and author, or check and mark ready. It comes with a button to take the step, **Skip this step** and **All steps**.

Once the page is ready, **Next step** also offers **Mark published**.

## The page's author

The header shows the page's author, picked from **Settings › Authors**, or your brand's team as the byline. The Content Agent can't add, edit or invent authors. For a page that advises on health, money or the law, the header also shows the qualified person who reviewed it.

## Before you publish

**Mark ready** opens **Before you publish** first. It checks:

- placeholders, alt text and links;
- the author;
- the qualified reviewer on pages that advise on health, money or the law;
- visible dates;
- the Article schema Ansvisor adds;
- a warning when Trust is under 60.

Copy and Export carry **Reviewed by** beside **Author** in the page metadata. Once the page's text names the reviewer, its structured data names them too, apart from the article author. On a page with a shopping path, **Before you publish** also names product cards whose price has changed in your catalog since they went in. **Send to CMS** opens it only when it has something to ask about.

An article goes to your CMS and to exports with an Article schema that names its author, or your brand when it has none. The page's text doesn't change. If your CMS adds its own, click **Leave it out**; **Add it back** undoes it. A page with an Article schema of its own gets none. WordPress leaves the schema out: add it with your SEO plugin.

## Export with Quality on

**Export** opens a dialog: the same files as without Quality, and under **Platforms** a copy of the page to paste into Webflow, WordPress, Shopify or Google Docs. A line over the options sums up **Before you publish**, and **Review** opens it.

If placeholders are still open, Export asks first: **Fill now**, or **Export without them**, which leaves out the sentences with a placeholder. One in the title or a heading has to be filled.
