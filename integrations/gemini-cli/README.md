# Ansvisor for Gemini CLI

A [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension that connects Gemini CLI to [Ansvisor](https://www.ansvisor.com)'s MCP server, so you can ask about your brand's AI visibility in a normal conversation: visibility, mentions, citations, prompts, competitors, AI traffic, content, Site Audits, product visibility and the Action Center.

It adds the remote MCP server `https://app.ansvisor.com/api/mcp` and a short context file that tells Gemini how to use its tools. Nothing runs on your computer.

## Install

```bash
gemini extensions install https://github.com/ansvisor/gemini-cli-extension
```

Gemini CLI shows what the extension adds and asks you to confirm. Restart Gemini CLI after installing. Gemini CLI starts MCP servers only in folders you trust, so trust the folder you work in when it asks.

Or from the root of a clone of the [Ansvisor repository](https://github.com/ansvisor/ansvisor), where Gemini CLI first asks whether you trust that folder:

```bash
gemini extensions install ./integrations/gemini-cli
```

## Sign in

When Gemini CLI first connects, Ansvisor asks it to sign in, and Gemini CLI asks to open your browser. You can also start it yourself with:

```text
/mcp auth ansvisor
```

Sign in to Ansvisor, check what Gemini CLI may do (untick **Make changes you ask for** to let it read only) and click **Allow**. The page shows the name Gemini CLI registers itself with, marked **Not checked by Ansvisor**, and sends you back to this computer. Gemini CLI keeps the sign-in and renews it on its own. It appears under **Settings › MCP & API Keys › Connected apps**, where you can disconnect it. A connection you don't use for 30 days is disconnected on its own.

Signing in needs a paid plan; in the free trial, use an API key. If `/mcp auth ansvisor` can't discover how to sign in, your Ansvisor doesn't offer sign-in for apps yet: use an API key.

## Or use an API key

An API key works on every plan, the free trial included.

1. In Ansvisor, open **Settings › MCP & API Keys**, click **New key** and copy it. It's shown once.
2. Put it in your shell profile:

   ```bash
   export ANSVISOR_TOKEN=ans_...
   ```

3. Add a server with the extension's server name, `ansvisor`, to your user settings. It takes precedence over the extension's, so Gemini CLI sends the key instead of signing in:

   ```bash
   gemini mcp add --scope user --transport http \
     --header 'Authorization: Bearer $ANSVISOR_TOKEN' \
     ansvisor https://app.ansvisor.com/api/mcp
   ```

   The single quotes keep the key out of `~/.gemini/settings.json`: Gemini CLI reads `$ANSVISOR_TOKEN` each time it starts. The command writes this entry, which you can also add by hand:

   ```json
   {
     "mcpServers": {
       "ansvisor": {
         "url": "https://app.ansvisor.com/api/mcp",
         "type": "http",
         "headers": { "Authorization": "Bearer $ANSVISOR_TOKEN" }
       }
     }
   }
   ```

The extension has no API key setting on purpose: Gemini CLI sends a header the extension declares in place of its own sign-in, even an empty one, which would break signing in.

To go back to signing in, run `gemini mcp remove --scope user ansvisor`.

## Check it works

Run `/mcp` to see the `ansvisor` server, its status and its tools, then ask "List my Ansvisor brands".

## What you can ask

- "What's my visibility score on ChatGPT for the last 7 days?"
- "Which competitors gained share of voice this month?"
- "Which sources does AI cite for us, and which cite competitors?"
- "What should I write or fix next?" (the content plan)
- "What's in the Action Center for this brand, highest priority first?"
- "Audit https://example.com/pricing" (uses a Site Audit credit)

Gemini CLI asks before it runs each Ansvisor tool, unless you choose to always allow it. Changes, such as accepting a suggested prompt or writing a content draft, need the Growth plan or above and the right role; Ansvisor refuses the others and says why. Ansvisor never publishes a page.

## Self-hosted Ansvisor

Use an API key from your own Ansvisor, and your host's address in step 3:

```bash
gemini mcp add --scope user --transport http \
  --header 'Authorization: Bearer $ANSVISOR_TOKEN' \
  ansvisor https://ansvisor.example.com/api/mcp
```

## Update or remove

```bash
gemini extensions update ansvisor
gemini extensions uninstall ansvisor
```

Uninstalling leaves a server you added in step 3; remove it with `gemini mcp remove --scope user ansvisor`.

More: [the MCP server guide](https://docs.ansvisor.com/guides/mcp-server) and [the Gemini CLI guide](https://docs.ansvisor.com/guides/gemini-cli).

The extension's source is [`integrations/gemini-cli`](https://github.com/ansvisor/ansvisor/tree/main/integrations/gemini-cli) in the Ansvisor repository. [`ansvisor/gemini-cli-extension`](https://github.com/ansvisor/gemini-cli-extension) is the copy Gemini CLI installs from, with the manifest at its root.
