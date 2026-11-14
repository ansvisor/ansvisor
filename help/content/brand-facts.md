---
title: Approve your brand facts
route: /dashboard/brands
keywords: [brand facts, approve facts, approved facts, prices and plans, trial, founding year, destination, route, operator, island, applies to]
synonyms: [fact check, facts per destination, price per route, facts per island, wrong price flagged]
plan: all
updated: 2026-11-14
last_checked: 2026-11-14
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, server/src/lib/brand-facts.js, server/src/lib/fact-scope.js]
---
**Brand facts** are your prices and plans, your trial, when you were founded and the claims you make, read from your own pricing, About and product pages. Open a brand's settings and go to the **Brand facts** tab.

## Approve or reject a fact

Each fact shows its value, the words on your site that hold it and the page it came from. Admins and managers **Approve** the right ones and **Reject** the others. Quality's Trust score checks your pages against the approved facts still on your site, and the Content Agent writes with them.

## Facts for one destination, operator or route

Some values differ by place: a ferry's price on one route, a tour's length on one island. Ansvisor sets the place when your site names it beside the fact or in the page's title. To change it, admins and managers select **Applies to** on the fact, type the place, such as Bozcaada, and select **Save**. Leave it empty for your whole brand. The list groups facts by place, your whole brand's first.

## How pages use them

A page is checked against, and written with, your whole brand's facts and the facts of the places its title, main heading or address names. Capitals, accents and Turkish letters don't matter: "gokceada" in an address names Gökçeada. Another place's fact is never counted as a conflict on the page.
