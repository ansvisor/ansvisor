---
title: Use your own AI keys
route: /dashboard/settings/ai-providers
keywords: [ai providers, own key, api key, openai, anthropic, openrouter, test ai key, key not working]
synonyms: [bring your own key, byok, my own openai key, connect my ai account]
plan: enterprise
updated: 2026-11-01
last_checked: 2026-11-01
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/faq.mdx]
---
Chat normally runs on your plan's monthly AI limit, and you don't need any key for it. On the Enterprise plan, an admin can connect the workspace's own account with an AI provider (Anthropic, OpenAI, Google Gemini, Microsoft Azure OpenAI or OpenRouter) in **Settings › AI Providers**. Chat then runs on that key: the provider bills your account, and your monthly AI limit doesn't move.

## Add a key

1. Open **Settings › AI Providers**. Only admins can add, replace or remove keys.
2. Click **Add key** next to the provider and paste the key.
3. If you save keys for more than one provider, click **Use for Chat** next to the one Chat should run on.

Keys are stored encrypted, and nobody can read a saved key back. If the server can no longer read the saved key, Chat stops rather than run on your plan's monthly AI limit: save the key again.

## Agents on your key

Agents run on the key too. Each agent's **Max per run** and **Monthly cap** still apply: Ansvisor measures what a run uses at the providers' list prices, so it is an estimate of your bill. Set a spending limit with your provider too: its bill is the real one.

## Keys saved before Chat

If your workspace saved a key before Chat was turned on for it, that key keeps running Chat for 30 days, on any plan. **Settings › AI Providers** shows the date it stops. Until then you can replace that key, but you can't add keys for other providers. After that date, Chat runs on your plan's monthly AI limit, and the page shows the key as **Not used on your plan**. You can remove it at any time.

## Below Enterprise

On the other plans, Chat runs on the plan's monthly AI limit, and **Settings › AI Providers** says own AI keys come with the Enterprise plan. When the limit runs out, an admin can move to a bigger plan on the **Billing** page.

## Check a key

Under each saved key, a line says whether it works: **Working · checked …**, **Not working since …** with why, or **Not checked yet**. Click **Test** to check it now: Ansvisor makes one tiny call on the key, which costs your provider well under a cent. A key is also tested when you save it or click **Use for Chat**. A key the provider turns down, or one that can't reach its model, isn't saved. A key whose account is out of credit is saved with a warning.

## When your key stops working

If the key Chat uses stops working, Chat stops on it and the agents that run on it pause. Nothing moves to your plan's monthly AI limit. Once the key works again, after a passing **Test**, a save or an answer from Chat, the paused agents start again by themselves. If you remove the key, they start again on your plan's monthly AI limit.

Every admin is told once, with a notice at the top of their Chat **Inbox** and an e-mail. **Fix it** opens **Settings › AI Providers**. If the key still doesn't work 3 days later, they get one reminder. The notice goes away once the key works again or is removed.
