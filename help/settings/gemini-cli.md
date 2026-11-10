---
title: Use Ansvisor in Gemini CLI
route: /dashboard/settings/api-keys
keywords: [gemini cli, gemini cli extension, gemini extension, install gemini extension, mcp auth]
synonyms: [use ansvisor in gemini, google gemini cli, ansvisor in the terminal, connect gemini cli, gemini command line]
plan: all
updated: 2026-11-10
last_checked: 2026-11-10
owner: Cihan
app_version: 0.3.0
approved: false
sources: [integrations/gemini-cli/README.md, docs/guides/gemini-cli.mdx, web/messages/en.json]
---
Gemini CLI, Google's AI assistant for the terminal, has an Ansvisor extension. It connects Gemini CLI to Ansvisor's MCP server and tells Gemini how to use its tools, so you can ask about your brand's visibility, mentions, citations, content, Site Audits and Action Center from your terminal.

## Install the extension

Install it with Gemini CLI's extensions install command and the extension's address, from the Gemini CLI extensions gallery or Ansvisor's Gemini CLI guide. Gemini CLI shows what the extension adds and asks you to confirm. Then restart Gemini CLI. It connects to Ansvisor only in folders you trust, so trust the folder you work in when it asks.

## Sign in

When Gemini CLI first connects, it asks to open your browser so you can sign in to Ansvisor. You can also type /mcp auth ansvisor in Gemini CLI. Choose whether it may **Make changes you ask for**, then click **Allow**. The page marks Gemini CLI **Not checked by Ansvisor**, because the app names itself.

Gemini CLI then shows under **Connected apps** in **Settings › MCP & API Keys**, where you can disconnect it. Signing in needs a paid plan.

## Use an API key instead

In the free trial, on a self-hosted Ansvisor, or when Gemini CLI can't find how to sign in, use an API key. Create one in **Settings › MCP & API Keys** with **New key**, then add it to Gemini CLI's own settings as a server named ansvisor. Ansvisor's Gemini CLI guide has the one command that does it. That server replaces the extension's, so Gemini CLI sends the key instead of signing in.

## What you can ask

- "What's my visibility score on ChatGPT for the last 7 days?"
- "What should I write or fix next?"
- "What's in the Action Center for this brand, highest priority first?"

Gemini CLI asks before it runs each Ansvisor tool. Reading works on every plan. Changes, runs and anything that uses credits need the Growth plan or above, paid, and the right role: Ansvisor refuses the others and says why.

## Remove it

Uninstall the extension with Gemini CLI's extensions uninstall command. To cut its access at once, also disconnect it under **Connected apps**, or revoke the API key it uses.
