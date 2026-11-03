---
title: Set the rules Chat follows
route: /dashboard/settings/chat
keywords: [chat rules, tool policy, full auto, don't ask again, managers publish, agents publish on their own, go live, model providers, turn off openai, turn off google, deepseek, data collection]
synonyms: [chat permissions, chat policy, let agents publish, autonomous publishing]
plan: growth
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: true
sources: [web/messages/en.json]
---
**Settings › Chat** holds the rules Chat follows in your workspace. Everyone can read them; only Admins change them. Each change counts from Chat's next step.

## Run modes and tools

**Full auto** lets people run changes without a card. **Don't ask again** lets each person skip a card for one tool. Both need the Growth plan.

Under **Tool policy**, set each tool to **Never**, **Ask** or **Always**, within what the tool allows. **Reset to defaults** puts every tool back.

## Model providers

**Model providers** lists the companies whose models Chat may use: Anthropic, OpenAI, Google and DeepSeek. Admins turn each on or off. A provider that is off has no model in the model menu, and agents and scheduled runs that picked one of its models run on Auto instead; the answer says so. Each change goes in the Activity log.

Anthropic is always on, because Auto runs on its models. DeepSeek is off until an Admin turns it on, and its models then run only on providers hosted in the US or the EU. Calls through OpenRouter go only to providers that don't keep or train on your data.

## What Managers may take live

Sending, publishing and other going-live steps always need a person's click. Turn a group off here, and a Manager gets **Ask your Admin** instead.

## Agents that publish on their own

Where your workspace has it, an Admin can let agents publish without a click. Turning it on opens a short dialog: tick that you understand and may decide this, then **Turn on**. Each agent then needs its own permission on its form, runs in **Full auto**, and goes live at most its daily limit. A page that fails Quality or your brand facts still waits for a click. It needs the Growth plan and Content Quality. Turning it off takes effect at once.
