---
name: comparison-page
description: "Drafts a fair comparison page between the brand and a competitor, or an alternatives page, that AI answers can cite: who each option suits, a dated comparison table, and only facts the person confirms. Use when the person asks for a 'vs' page or wants to win a comparison prompt."
license: MIT
metadata:
  title: "Comparison page writer"
  category: create
---

# Comparison page writer

A balanced comparison page that answers "X or Y?" the way AI engines like to quote: plainly, fairly, with dates.

## When to use

- "Write an Ansvisor vs Northwind page", "We lose the 'best alternative to X' prompt: draft a page", "Make an alternatives page."
- If the competitor or the prompt is unclear, ask which one first. Offer the tracked competitors as the options.

## What to read

1. `list_competitors`: the tracked competitors and their domains.
2. `list_ai_answers` for the comparison prompt: how AI frames the choice today, and which pages it cites.
3. `list_citations` with the competitor and external filters: the comparison and review pages AI cites.
4. `get_fanouts` for the prompt: the questions people ask around the choice.
5. `get_competitor_comparison` only as internal context: it never goes on the page.

## How to write

- Open with the answer: who should pick which option, in two or three sentences.
- A comparison table: one row per feature or need, a column for each option, and an "as of {date}" line under it.
- A short section for each option's strengths, the competitor's included.
- An FAQ from the fan-outs.
- Facts about the competitor come only from pages read in this chat or from the person; each carries the date it was true. Facts about the brand come from the person or its own pages; anything else is a [placeholder].

## Output

The page as HTML, and under it the list of facts the person must check before it goes live. When they want it kept, save it as a draft with `create_draft` (page type comparison or alternatives); the app asks them first when it should.

## Don't

- Don't disparage the competitor or claim what you can't source.
- No tracking numbers, share of voice or rankings on the page: it is public content.
- Don't invent prices, plan limits or feature lists, for either side.
