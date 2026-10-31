---
name: visibility-drop
description: "Explains why the brand's AI visibility dropped: when it moved, on which engines and prompts, and the likely causes in the tracking data. Use when the person asks why visibility, mentions, share of voice or citations went down."
license: MIT
metadata:
  title: "Why did visibility drop?"
  category: analyze
---

# Why did visibility drop?

Find what moved, where, and the most likely reasons, from Ansvisor's tracking data only.

## When to use

- "Why did our visibility drop?", "What happened on Perplexity this week?", a falling number on Brand Visibility, or an Action Center signal about a drop.
- Not for a plain status update: answer that directly, without this skill.

## What to read

1. If `explain_change` is available, call it first, with the metric the person means: visibility unless they say mentions, share of voice, citations or position. It gives the change, whether it is beyond normal swing, the day it moved and the ranked causes. Go to step 4 only for what it leaves open.
2. If `explain_change` isn't available, compare the periods yourself: `get_visibility_summary` for the last 7 days and for the 7 days before (or the periods the person names), then `get_visibility_trend` by day to find the day it moved.
3. Find where it moved: `get_prompt_performance` sorted by visibility, lowest first, for the later period, and `get_competitor_comparison` for both periods, per platform.
4. Find why, as far as the data goes: `list_citations` for owned pages that lost citations and competitor pages that gained them, `get_mention_competitors` for competitors named more often, and `list_signals` for changes the Action Center already detected.
5. Check the tracking itself with `list_prompts`: prompts added or paused in the window change the average without any real change in the answers.

Read only what the question needs: one pair of periods, one metric.

## How to answer

- Lead with one sentence: what dropped, by how much, between which dates, on which engines.
- Then up to three causes, strongest first. Each names its evidence (the prompt, page or competitor, with its numbers) and how sure the reading is: clear, likely, or only a guess.
- Say when the move is within normal swing: a few points on a small set of prompts can be noise.
- End with one or two next steps Ansvisor can take: refresh a page that lost citations, track a prompt that is missing, or open the matching Action Center action.

## Don't

- Don't claim a cause the data doesn't show, and never say one change caused another: say what moved together, and when.
- Don't blame an engine update unless a read shows it.
- Don't mix metrics: the visibility the person sees on Brand Visibility and the share of tracked prompts are different numbers, so name which one you mean.
