# Ansvisor Skills

A collection of opinionated [Anthropic Skills](https://docs.anthropic.com/claude/docs/skills)
that turn Claude into an AEO analyst with live access to your Ansvisor
account.

Most skills come in **two flavours**: one that talks to the
[Ansvisor MCP server](../docs/guides/mcp-server.mdx) (cleaner UX in
clients that support it) and one that calls the REST API directly with
code execution (works anywhere). Pick the flavour that matches your
Claude client — see the table below.

Without a skill, Claude can still hit our tools/API if you tell it
how — it'll just answer generically. With one of these installed, it
behaves like an AEO analyst who's been on your account for six months.

## Skills in this repo

| Skill | Flavour | What it's for |
| --- | --- | --- |
| [`ansvisor-aeo-coach`](./ansvisor-aeo-coach) | **MCP (preferred)** | Brand snapshots, visibility deep-dives, competitor watch. Use this when your client (Claude Desktop, Claude Code, Cursor, Zed) is connected to the Ansvisor MCP server. |
| [`ansvisor-aeo-coach-standalone`](./ansvisor-aeo-coach-standalone) | **REST (fallback)** | Same skill, no MCP needed. Use this when you're on claude.ai web without a Connector, or any surface where setting up MCP isn't an option. |

## Which flavour should I install?

| Your client | Recommended |
| --- | --- |
| Claude Desktop | **MCP** — install the [MCP server](../docs/guides/mcp-server.mdx) once, then `ansvisor-aeo-coach` |
| Claude Code | **MCP** — same as above |
| Cursor / Zed / other MCP-aware tools | **MCP** — it's their native primitive |
| claude.ai web with the Ansvisor Connector configured | **MCP** |
| claude.ai web without a Connector | **Standalone** — single install, no extra setup |
| Anywhere else with Skills + code execution | **Standalone** |

Both flavours hit the same data, format the same way, and share the
same `references/` knowledge files. The difference is just _how_ Claude
fetches numbers — typed tool calls vs. inline Python HTTP requests.

## Prerequisites

You need an **Ansvisor API key** in either flavour:

1. Open your Ansvisor dashboard → **Settings → API Keys**
2. Click **New key**, give it a memorable name (e.g. _Claude — laptop_)
3. Copy the token (`ans_...`). It's shown **once** — store it in your
   password manager

If you self-host Ansvisor, both flavours work against your own instance
— you'll just provide a different base URL when prompted (MCP: in your
client config; standalone: when the skill asks).

## Install

Skills are just markdown files — they work in any Claude surface that
supports the Skills feature.

### Claude.ai (web)

1. Open <https://claude.ai/skills>
2. Click **New Skill** → **Paste from markdown**
3. Paste the contents of your chosen flavour's `SKILL.md`
4. Save

The first time you use the MCP flavour, you also need the **Ansvisor
Connector** added to your Claude.ai account (see the MCP guide). The
standalone flavour will ask you for your API key in the conversation
itself.

### Claude Code / Claude Desktop

```bash
git clone https://github.com/ansvisor/ansvisor.git
cp -r ansvisor/skills/ansvisor-aeo-coach ~/.claude/skills/   # MCP flavour
# or
cp -r ansvisor/skills/ansvisor-aeo-coach-standalone ~/.claude/skills/
```

Restart your Claude client and the skill is live. If you chose the MCP
flavour, also configure the
[Ansvisor MCP server](../docs/guides/mcp-server.mdx) in your client.

## Use

Once installed, just ask in plain English:

- _"How is my brand doing this week?"_
- _"Why did visibility drop on ChatGPT?"_
- _"Who are my biggest competitors right now?"_
- _"Give me a 30-second standup on the Acme brand."_

Claude picks the right tools / endpoints, fills in filters, interprets
the numbers, and answers with action items.

## Contributing

Got an idea for another skill? Open a PR with a new folder under
`skills/`:

```
skills/
  your-skill-name/
    SKILL.md           # frontmatter + body
    references/        # optional supporting docs
```

A few principles we follow:

- **Skills layer knowledge, not data.** Data comes from the MCP server
  or the matching REST endpoint. A skill's job is to know _when_ and
  _how_ to use it.
- **Be opinionated about output.** Marketers don't want a CSV dump —
  they want a 3-line summary, a delta, and a suggested next step.
- **Ship MCP and standalone flavours together when it makes sense.**
  Users on different surfaces shouldn't have to fork the skill
  themselves.
- **Handle errors gracefully.** Missing tool / bad key / empty data →
  tell the user, don't fabricate.
- **Don't echo API keys.** In the standalone flavour, hold tokens in
  execution memory and redact them in any output.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for branch naming, commit
conventions, and PR workflow.

## License

[MIT](../LICENSE) — part of [Ansvisor](https://github.com/ansvisor/ansvisor).
