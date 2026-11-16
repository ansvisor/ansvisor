---
title: Ads Opportunities: the decision for each buying-intent prompt
route: /dashboard/ads
keywords: [ads opportunities, earn, pay, earn + pay, decision, change decision, back to the recommendation, thresholds, who ai picks, google searches, ad channels, opportunity drawer, what ai answers today, send to action center, do both, export for google ads editor, export this prompt, /earn-or-pay]
synonyms: [earn or pay, buying prompts list, override decision, which prompts to pay for, ads csv, google ads editor file, fix the answer]
plan: all
updated: 2026-11-16
last_checked: 2026-11-16
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/app/[locale]/(dashboard)/dashboard/ads/_opportunities.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_opportunity-drawer.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_earn-card.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_do-both.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_export.tsx, web/src/app/[locale]/(dashboard)/dashboard/ads/_thresholds.tsx, server/src/lib/ads/decision.js, server/src/lib/ads/opportunities.js, server/src/lib/ads/export.js, skills/earn-or-pay/SKILL.md]
---
**Opportunities**, a tab of **Ads**, lists your brand's buying-intent prompts for the period, the most searched first. Each has a decision: **Earn** the AI answer with content, **Pay** for an ad beside it, or **Earn + pay**. A decision is a recommendation, and **Open** on a row shows why and what to do.

## What each row shows

- **Prompt**, with its topic under it.
- **Decision**: the decision in force. When someone changed it, **Recommended:** under it gives the rule's.
- **Who AI picks**: **You**, the competitor AI names first, or **No clear leader**. Under it, where AI names you, such as **You: #2, cited**, or **You: not named**.
- **Google searches/mo**: point at the number for the exact count and, where there is one, the AI estimate. **Not measured** when the prompt has no search volume yet.
- **Channels**: where an ad could show beside the AI answers you track: **ChatGPT**, **Google** (AI Overviews and AI Mode) or **Microsoft** (Copilot). A dash means the decision needs no ad.

## How the decision is made

Ads reads who AI picks, whether it cites your pages, and the prompt's Google searches:

- A competitor leads the answer: **Earn + pay** when the prompt has enough searches, **Earn** otherwise.
- No competitor leads, and AI picks you or cites your pages: **Earn**, to keep it.
- No one leads and AI cites none of your pages: **Earn**, or **Earn + pay** with enough searches.

Who pays on a prompt isn't measured yet, so decisions read AI answers and Google searches only, and the rule doesn't pick **Pay** by itself. A prompt tracked only on engines that carry no ads gets **Earn**, and its drawer says why.

## Filter and change a decision

**All**, **Earn + pay**, **Pay** and **Earn** above the table filter the rows, each with its count.

Admins and Managers on Growth or above can change a prompt's decision: click its pill and pick **Earn**, **Pay** or **Earn + pay**. **Back to the recommendation** returns it to the rule's. Your choice stays until someone changes it, and the drawer and Chat follow it. Everyone else sees the pill only.

## Thresholds

Admins on Growth or above see **Thresholds** above the table. Its three lines decide every brand's opportunities in the workspace:

- **Buying intent from (0 to 1)**: which intents count as buying.
- **We lead when AI names us at or above**: the position that counts as leading.
- **Pay from Google searches/mo**: the searches from which the rule adds paying.

Each field shows its default; leave it empty to keep that. **Save** updates the decisions at once. The free trial can't change them.

## The opportunity drawer

**Open** on a row opens its drawer. At the top are the prompt, its decision and the reasons for it, one a line. **What AI answers today** shows the latest answer on each platform in the period, with where AI names you, the competitors it names and the sites it cites. Sponsored ads in the answer aren't captured yet, so none are shown.

**Fan-out queries** are the searches AI ran for the prompt, and **Keyword seeds** its main search terms. The **Earn** and **Pay** cards come next. Close the drawer with **✕**, Esc or a click outside it.

## Earn: send the fix to the Action Center

The **Earn · fix the answer** card shows for **Earn** and **Earn + pay**. It names the page to refresh, or says to write a page that answers the prompt, and why. Admins and Managers on Growth or above click **Send to Action Center** to add it as one action with its task.

If an open action already covers the prompt, the card links that action instead, such as **Open AC-12**, so nothing is added twice. After you send it, the card says **Sent** and links the new action.

## The button at the bottom

The drawer's main button follows the decision:

- **Earn**: **Send to Action Center**.
- **Pay**: **Create ad drafts**.
- **Earn + pay**: **Do both**, which sends the fix and creates the drafts in one click.

Once one half is done, the button offers only the other. If one half fails, a line says which, and **Retry the Action Center task** or **Retry the ad drafts** retries only that one. Nothing is sent to an ad platform. Only Admins and Managers on Growth or above see the button.

## Export for Google Ads Editor

Admins and Managers on Growth or above can export. **Export** › **Export for Google Ads Editor** saves a file of the rows under your filter, and **Export this prompt** in a drawer saves one prompt.

Each topic is a campaign and each prompt an ad group, with keywords from its seeds and fan-outs, its saved Google and Microsoft drafts, and a page on your own site to land on. Keywords that name a competitor are left out, and everything in the file is paused. A link outside your domains is replaced with your home page, and a message says how many were. You import the file into Google Ads Editor yourself: Ansvisor sends nothing.

## On Starter and in the free trial

You see the first rows, most searched first, and a lock row that says how many more prompts Growth includes, with **Upgrade**. You can open these rows' drawers and read them. Changing decisions, sending fixes, ad drafts and exports need Growth or above.

## Ask Chat: /earn-or-pay

**Earn or pay** (**/earn-or-pay**) in Chat explains a prompt's or a topic's decision: why, who AI picks, your position and its Google searches, then one next step. For **Earn**, it offers to send the fix to the Action Center and asks you first. For **Pay**, it points to **Ad drafts**. It reads the rows your plan shows, never guesses locked ones, and never changes a decision: that stays on this page.
