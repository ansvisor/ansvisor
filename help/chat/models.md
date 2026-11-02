---
title: Pick the model and effort Chat uses
route: /dashboard/chat
keywords: [model, choose model, pick model, model menu, auto, haiku, sonnet, effort, normal effort, high effort, max effort, multiplier, 2.3x, uses your limit faster, own api key, your key]
synonyms: [ai model, llm, which model, switch model, thinking effort]
plan: starter
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json]
---
Chat runs on **Auto** unless you pick a model: Haiku 5.5 reads your data and Sonnet 5.5 writes the answer. The model button under the message box shows what the chat runs on. Click it to open the model menu.

## Pick a model

The menu lists **Auto** first, marked **Default**, then the models Chat is tested with. Each shows how fast it uses your monthly AI limit compared with Auto: **1x** is Auto, **2.3x** uses it a bit over twice as fast, **0.1x** a tenth as fast. Under 1x shows in green, 3x and more in amber. A model whose price changes by the hour says so.

Your pick goes with every message in that chat. When you open the chat later, the menu starts on the model its last answer used. A new chat starts on Auto.

The line under the list says when the prices were last read. The menu never shows prices, only how each model compares with Auto.

## Effort

**Effort** sets how hard Chat works on each answer: **Normal**, **High** or **Max**. High and Max read more of your data and think longer, so they use your AI limit faster. Effort goes with the chat, like the model.

## In the free trial

In the free trial, Chat runs on Auto at Normal effort, and the other models are locked. Starting your plan lets you pick any model and effort.

## When a model is no longer offered

If the model a chat used is no longer available, the menu says so and Chat answers on Auto instead.

## Your own API key, usage and plan

The bottom of the menu shows:

- **Use your own API key**: on Enterprise, **Included in your plan** opens **Settings › AI Providers**, where an Admin saves keys. A key saved before Chat started works until the date shown. On other plans, own keys come with Enterprise. Models that run on your own key say **Your key**.
- **Monthly AI usage**: how much of this month's AI limit your workspace has used, and when it resets.
- **Your plan**, with **See plans**.
