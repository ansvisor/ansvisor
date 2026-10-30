---
title: Write a page in the Content Editor
route: /dashboard/content/editor
keywords: [content editor, draft, placeholders, mark ready, mark published, history, export]
synonyms: [write an article, edit a draft, page editor, finish a page]
plan: all
updated: 2026-10-30
last_checked: 2026-10-30
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/content-editor.mdx]
---
The Content Editor is where pages are written. It opens from the Library, from the Plan, or when you start a page in New content. **Editor** in the sidebar takes you back to the draft you last opened for this brand in this browser. The page saves as you write.

## The header

The header shows the title, the page type, a **Rules** chip with how many rules the page meets now, and whether your changes are saved. Its buttons are **History**, **Copy HTML**, **Export**, **Send to CMS** (admins and managers) and **Mark ready**, and a button to show or hide the side panel.

Where your workspace has Chat, a pill next to the title says where the page stands: **Working** while the Content Agent works on it, **Needs you** while its suggestions wait or the page is in review, **Ready**, **Done** once published, or **Draft**. **Runs** at the top lists your own Chat runs and this brand's Content Agent runs, this page's among them; click one to open it. Once the agent's work has started on the server, its card says you can leave the page: it keeps going.

## Write and paste

The page starts with its H1, which is also its title. A page has one H1: the toolbar won't add a second one. A paste keeps headings, lists, links and tables, and drops fonts, colors and styles. Press Command or Ctrl + Shift + V to paste plain text.

**Attach a file** inserts Excel, CSV, Word, Markdown, HTML or text, up to 10 MB each; a sheet comes in as a table. **Add HTML** adds an embed, a widget or a form, kept exactly as written; Ansvisor never runs it. **Edit as HTML** shows the page's source; scripts, iframes and inline styles are removed when you switch back.

## Placeholders in brackets

Words in square brackets, such as [figure, source] or [competitor], are placeholders: the Content Agent leaves one where a real name, quote or number goes. Each is tinted amber, and the toolbar counts those left to fill. Click the count, or the arrows beside it, to go to the next or previous one, already selected, so you can type over it.

A placeholder in an image's alt text, the structured data or an HTML block is counted too, and **Show in HTML** selects it in the HTML view. Send to CMS waits until none is left.

## Brief and Sources

The side panel's tabs are **Instructions**, **Sources** and **Live page**. **Instructions** opens on **Rules**, with **Brief** beside it.

- **Brief**: the page type, target URL, goal, audience, length, outline and keywords, which **Edit brief** changes. **Rebuild brief** writes a new outline from the sources you keep, each H2 answering a search AI ran for your prompts. **Rewrite from brief**, for a new page, or **Suggest changes from brief**, for an existing one, hands the page to the Content Agent; the page you have now stays in History.
- **Sources**: the prompts, fan-outs, cited pages and Search Console queries the draft is built from. Uncheck one to leave it out, or **Add source**, then **Rebuild with selection**.

## Live page

For a draft that optimizes a live page, **Live page** shows how that page does now: **Citations**, **AI visits**, **Google clicks** and **Prompts cited**, over 7 days to a year, against the period before. It is not a forecast of what the draft will get. A new page has nothing to measure yet.

Prompts that stopped citing the page are marked **Lost**. **Use the lost prompts in this draft** adds them to the sources and rebuilds the brief. With conversions from AI visits on, **Conversions from AI journeys** shows what the journeys through the page brought in.

## Passages AI cites are locked

When a draft optimizes a live page brought in by its URL, the passages AI answers quoted in the last 30 days are marked in green, and a chip in the header counts them. The Content Agent never changes these passages. If you edit one, the editor asks first: **Keep wording** or **Edit anyway**. Changing a quoted passage may cost the page those citations.

## History, Copy HTML and Export

- **History** keeps earlier versions for 90 days: the live page as imported, the page before agent changes, each Mark ready and publish, and the page before a restore. **Restore** makes a new version, so nothing is lost.
- **Copy HTML** copies the whole page as HTML, HTML blocks and schema included, to paste into your CMS.
- **Export** downloads the page as **Word**, **Excel**, **CSV**, **HTML** or **Markdown**. Only the HTML file carries the schema.

## Add products from your catalog

On an online shop's draft, **Products** in the toolbar adds products from your catalog: search by name, pick one to four that are in stock, and click **Insert**. One shows as a card, more as a grid, each with its picture, name and price, linked to its page. A card keeps its price: to show today's, delete the card and add the product again.

## Mark ready and Mark published

**Mark ready** saves the page, sets it to **Ready** and keeps a version in History. If the draft was sent to the Action Center, it also completes its task there. Ansvisor doesn't publish the page: copy or export it to your site, or send it to your CMS.

Once the page is live, **Mark published**, in the Library's **Status** menu or under **Next step** in the header, asks for its live address, and **Live page** measures that address from then. A page your CMS reports live gets its address on its own. Click **Ready** in the header to move the page back to **In review**.
