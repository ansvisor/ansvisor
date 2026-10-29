---
title: Write to the Content Editor rules
route: /dashboard/content/editor
keywords: [content rules, run agent, agent suggestions, accept suggestions, rules tab]
synonyms: [writing rules, style guide rules, fix open rules, apply rules with agent]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/content-editor.mdx]
---
Every page in the Content Editor is written to a set of rules for its page type. The **Rules** chip in the header shows how many the page meets now, and the Content Agent can suggest changes for the rules it doesn't meet yet.

## The Rules tab

In the side panel, **Instructions** opens on **Rules**. The rules come in five groups: page type rules, length and structure, fan-outs and keywords, links and sources, and style. Most rules can be turned on or off, and many have a value you can change. Each rule's status is read from the page as you write. Rules marked **AI check** are judged by the Content Agent and aren't counted yet.

## Save or reset your rules

Changes to the rules apply to this draft only. **Save as my rules** keeps them for your workspace's next drafts of this page type, and **Reset** goes back to the default set. Under **Your text rules**, write a rule in your own words, or use **Paste many** to add several from a style guide.

## Let the agent fix open rules

**Run Agent**, in the Rules tab, asks the Content Agent to suggest changes for the rules the page doesn't meet yet. Its suggestions appear in the page, each with **Accept** and **Reject**, under a bar with **Accept all** and **Reject all**.

A decided suggestion can be taken back with **Undo** or **Restore**, and **Undo all** brings every one back to review. One run makes at most eight changes: run it again for the rules still open. Running the agent uses your workspace's monthly AI usage.

## Before you run it again

- Accept or reject the open suggestions before you run the agent again or edit the page as HTML.
- The agent doesn't change heading levels: turn extra H1s into H2s in the toolbar yourself.
- The agent only changes drafts, not published pages.

## How your choices teach the agent

What you accept and reject teaches the agent. For a rule whose suggestions this brand has mostly rejected over the last 90 days (at least five decided, on two pages or more, seven in ten rejected), it keeps its changes as small as the rule allows, and its card says which rules while it works. Only its small changes count: a rejected **Rewrite the whole page** doesn't.

## On a page that is already live

When the draft optimizes a live page, the agent is also told how that page does now, as the **Live page** tab shows it over 30 days: how often AI answers cite it and the prompts it lost. It keeps the answers and facts AI engines cite, answers a lost prompt's question where a rule's change can, and its card says what it kept in mind.
