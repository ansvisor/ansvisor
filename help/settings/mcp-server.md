---
title: Use Ansvisor in AI assistants with MCP
route: /dashboard/settings/api-keys
keywords: [mcp, mcp server, api key, claude, chatgpt, cursor, codex, connect assistant, connected apps, sign in]
synonyms: [model context protocol, use ansvisor in claude, use ansvisor in chatgpt, ai assistant integration, connector, oauth, app sign-in, disconnect app]
plan: all
updated: 2026-11-10
last_checked: 2026-11-10
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/mcp-server.mdx, web/messages/en.json]
---
Ansvisor has an MCP (Model Context Protocol) server, so AI assistants such as Claude, ChatGPT, Codex, Cursor, VS Code, Windsurf, Gemini CLI and Zed can query your Ansvisor data in a normal conversation. There is nothing to install. Claude and ChatGPT connect by signing in to Ansvisor. Other assistants connect with an API key from **Settings › MCP & API Keys**.

## Connect Claude or ChatGPT by signing in

1. Open **Settings › MCP & API Keys** and copy the address under **MCP endpoint**.
2. Add it as a connector in your assistant. In Claude, that's **Settings › Connectors › Add custom connector**: enter a name and the address, with no key. On Claude's Team and Enterprise plans, an owner adds the connector in the organization settings first.
3. Your assistant opens Ansvisor. Sign in as usual.
4. Ansvisor shows the app, the site you'll go back to, and your workspace, role and brands. Leave **Make changes you ask for** ticked, or untick it so the app only reads. Click **Allow**.

Ansvisor asks every time you connect an app. If it says **Not checked by Ansvisor**, allow it only if you started the connection yourself.

## Create an API key

1. Open **Settings › MCP & API Keys**.
2. Click **New key** and give it a name you'll recognize, such as "MCP — my laptop".
3. Click **Create** and copy the key. It's shown only once, so store it somewhere safe, such as your password manager.

## Connect your assistant with a key

The dialog that shows the key also has a ready-to-paste setup for each assistant under **Connect a client**, with the key filled in. Pick yours, click **Copy setup**, and follow the line under it, which says where the setup goes. Because it includes the key, copy it before you close the dialog. Claude can use a key too, instead of signing in.

On a self-hosted install, the assistant connects to your own Ansvisor instead. Apps can sign in there when it runs on a secure (https) address; otherwise, use a key.

## Check the connection

Ask your assistant "List my Ansvisor brands". It should show your brands. If it reports a 401 error, the key is missing from the setup or was revoked. An app you connected by signing in asks you to sign in again instead, for example after you disconnect it.

## What you can ask

Ask in plain words, for example:

- "What's my visibility score on ChatGPT for the last 7 days?"
- "Which topic has the most prompts?"
- "Who are my top 5 competitors by mention count this month?"
- "Why did our sentiment drop on Gemini?"

The assistant can read visibility, mentions, citations, prompts, AI traffic, saved reports, content, Site Audits, product visibility and the Action Center. Some requests change data, such as accepting a suggested prompt, writing a content draft or recording a task's progress. Assistants are told to make a change only when you ask for it.

## What your plan includes

On Ansvisor Cloud, an app can connect by signing in on every paid plan: Starter, Growth and Enterprise. It can't in the free trial, or once the plan has ended: use an API key until an admin chooses a plan. A key reads on every plan, the free trial included.

Changes, runs and anything that uses credits, such as accepting a suggestion, writing a content draft or starting a Site Audit, need the Growth plan or above, paid, however the assistant connects. On Starter and in the free trial, the assistant still sees those requests, but Ansvisor refuses them and says they need Growth, so it can tell you why. The same applies to the API. An admin can upgrade in **Settings › Billing**. A self-hosted instance can do everything.

## What a connected app or key may do

A key acts as the person who created it, and an app you connected by signing in acts as you. Both have that person's role and brands, read again on every request, so a change to their access counts from the next one. Reading, drafts and suggestions in the Content Editor, Site Audits, task progress and an opportunity's progress are open to every role.

Adding prompts or topics, reviewing tasks, dismissing, and work that costs AI, such as content briefs and Improve actions, are for admins and managers. Dismissing a prompt suggestion is open to analysts too. Anything a role can't do is refused before it changes anything.

An app you let only read is told "This connection can only read" when it tries a change. Connect it again with **Make changes you ask for** ticked.

## Connected apps

**Connected apps**, above your keys in **Settings › MCP & API Keys**, lists the apps you connected by signing in. Each shows whether Ansvisor recognises it or it is **Not checked**, whether it may **Read only** or **Read and changes**, where it connects from, when you connected it and when it was last used. You see only your own apps, as with keys.

An app you haven't used for 30 days is disconnected on its own. If you leave the workspace, your apps are disconnected too. To use an app again, connect it again from the app.

## Disconnect an app

Click **Disconnect** next to the app and confirm. It loses access to Ansvisor at once, and the next time you use it there, it asks you to sign in again. You can disconnect an app on a read-only workspace too.

## Publish a draft from your assistant

Ansvisor never sends a page to your CMS through MCP. Instead, the assistant can get a draft as a page ready for your CMS, put it there with its own CMS connector, and then mark the draft published at the address it went live at, so Ansvisor measures it.

## When the plan has ended

On Ansvisor Cloud, a workspace without an active plan is read-only. Its API keys keep working for reading, but every change is refused until an admin chooses a plan in **Settings › Billing**. Retrying doesn't help. New API keys can still be created; on a read-only workspace they only read.

Apps connected by signing in stay connected, but Ansvisor answers every request, reads too, by saying the plan has ended, so the assistant can tell you why. They work again once an admin chooses a plan. A self-hosted instance is never read-only.

## Revoke a key

If a key leaks or you stop using an assistant, open **Settings › MCP & API Keys** and click the trash icon next to the key. Assistants using it lose access immediately.
