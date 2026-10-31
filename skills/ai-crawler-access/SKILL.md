---
name: ai-crawler-access
description: "Checks whether AI crawlers and assistants can reach the brand's site: robots.txt rules for GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and others, llms.txt, and the AI visits Ansvisor sees. Use when the person asks if AI can crawl their site or why an engine never cites them."
license: MIT
metadata:
  title: "AI crawler access check"
  category: technical
---

# AI crawler access check

Find out which AI crawlers may read the site, what that means for training, search and live answers, and what to change.

## When to use

- "Can ChatGPT crawl our site?", "Are we blocking AI bots?", "Perplexity never cites us: is it robots.txt?"

## What to read

1. `get_site_audit_summary`, then `list_site_audit_issues` for the latest audit: the AI bot access check (robots.txt) and the llms.txt check, with what each found.
2. `get_ai_traffic_summary`: visits AI assistants sent to the site, by platform. Visits from a platform show its assistant can reach the site.
3. `list_connections` when the traffic read is empty: whether Search Console and Analytics are connected at all.

Chat can't open the live robots.txt. When there is no audit, or it is old, say so and suggest running a Site Audit first.

## The crawlers

Three kinds, and blocking one doesn't block the others:

- **Training:** GPTBot (OpenAI), ClaudeBot (Anthropic). Google-Extended and Applebot-Extended aren't crawlers but robots.txt names that control training use by Google and Apple.
- **Search:** OAI-SearchBot (ChatGPT search), Claude-SearchBot, PerplexityBot. Blocking these keeps the site out of those engines' answers.
- **User:** ChatGPT-User, Claude-User, Perplexity-User fetch a page when a person asks about it.

## Output

1. One sentence: can the AI engines that matter reach the site.
2. A table: Crawler, Kind, Allowed (from the audit, or "not checked"), What to change.
3. Suggested robots.txt lines in a code block, for the choices the person makes: allowing search and user crawlers is the usual choice when they want to be cited.
4. Whether an llms.txt exists, and that the llms.txt builder skill can write one.

Changes go live only when the person or their developer updates the site.

## Don't

- Don't advise blocking every AI crawler, or allowing all of them, without saying what each choice costs.
- Don't present robots.txt as a guarantee: it is a request crawlers choose to follow.
- Don't guess what the live file says when no audit read it.
