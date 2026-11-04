# What's new

Short notes on what Ansvisor added, for the people who use it (CHAT-11). Chat shows them on Chat Home ("New" line), in the What's new answer and, when someone asks for it, in a monthly summary. The team writes them; Cihan approves them in the pull request. Chat never writes or changes one: it picks, orders and, for someone writing in another language, translates them.

## Where

`whats-new/{slug}.md`, one file per entry. The slug is the file name, in kebab-case.

## Front matter

```yaml
---
feature: Agent Center
home_line: Agent Center runs your routine AI visibility work for you.
route: /dashboard/agents
plans: [starter, growth, enterprise]
plan_mode: show_upgrade
published: 2026-11-03
approved: false
---
```

- `feature`: the feature's name as the app shows it, 40 characters or fewer.
- `home_line`: the one sentence on Chat Home's New line, 120 characters or fewer.
- `route`: the page **Try it** opens, with the brand open at the time. An address of the app, no query.
- `plans`: the plans that include it (`starter`, `growth`, `enterprise`). Self-hosted sees every entry.
- `plan_mode`: what a workspace on another plan sees: `hide` (nothing) or `show_upgrade` (the entry, with "On {plans}." and See plans).
- `requires` (optional): a switch staff turn on per workspace that the feature also needs. `auto_go_live` (Agents that publish on their own) shows the entry only where that switch is on. Leave it out for a feature every workspace on the plans has.
- `published`: the day it starts to show (YYYY-MM-DD). An entry can be merged before its day.
- `approved`: `false` until Cihan approves it.

## Body

Three or four lines, one sentence each, in this order: why we built it, what it does, how you benefit, what you can do. Two may share a line. Each line is 120 characters or fewer.

- Benefit only, in the app's words. No model names, API terms, versions, internal codes or "we rebuilt the backend".
- No prices, and no plan names in the words: they come from Billing (`plans`).
- No Markdown or links: the card adds **Try it**.

`web/src/lib/chat/whats-new/entries.test.ts` checks every entry against these rules. The app reads the approved ones from `web/src/lib/chat/whats-new/entries.json`: after approving an entry or changing an approved one, run `yarn test -u src/lib/chat/whats-new` in `web/` and commit the file.
