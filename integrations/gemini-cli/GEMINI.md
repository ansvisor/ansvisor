# Ansvisor

Ansvisor is an AI visibility product. It asks AI answer engines (ChatGPT, Claude, Gemini, Google AI Overviews, Google AI Mode and Bing AI Mode) the questions a brand's customers ask, then shows how often the brand is named and cited, how it compares with competitors, and what to do about it: content to write or fix, Site Audits of pages, and Action Center tasks.

This extension connects you to Ansvisor's MCP server. Its tools show up as `mcp_ansvisor_<tool>`. They act as the person who signed in or created the API key, with that person's role, brands and plan.

## How to work with the tools

- Call `list_brands` first to get the brand id the other tools need. A brand with `is_demo: true` is the demo brand: sample data you can read, where every change, run or generation is refused. Say so when you report on it.
- `get_me` tells you who the connection acts as and their role.
- Quote the AI Visibility Score (0 to 100) without a `%` sign. Search volumes are estimates: quote the range the tool gives, not one number.
- Read tools (`list_*`, `get_*`) never change anything. Every other tool changes data, runs something or uses credits. Call one only when the person asked for that change, for that specific item, and never while exploring.
- Each tool's description has the details: what it returns and when to use it. Follow it.

## Tools

**Start here**: `list_brands`, `get_me`, `get_prompt_usage` (tracked prompts against the plan limit), `get_ai_usage` (the monthly AI allowance used).

**Visibility and competitors**: `get_visibility_summary` (the headline score and its parts), `get_visibility_trend` (by day or week), `get_prompt_performance` (by prompt), `get_prompt_locations` (each prompt by country, state or city), `get_competitor_comparison` (share of voice), `list_competitors`.

**Mentions**: `get_mentions_summary`, `list_mentions`, `get_mention` (one full response), `get_mention_competitors`, `get_mentions_perception` (what AI associates with the brand). Change: `override_mention_sentiment`.

**Citations and AI traffic**: `list_citations` (the sources AI cites), `get_ai_traffic` (visits referred by AI engines).

**Prompts and topics**: `list_topics`, `list_prompts`, `get_prompt_volumes`, `list_topic_suggestions`, `list_prompt_suggestions`. Changes: `accept_topic_suggestion`, `dismiss_topic_suggestion`, `accept_prompt_suggestion`, `dismiss_prompt_suggestion`.

**Reports**: `list_reports`, `get_report` (saved snapshots, not regenerated).

**Content**: `get_content_plan` (what to write or fix next), `list_content_opportunities`, `get_content_opportunity`, `list_content_drafts`, `get_content_draft`, `get_content_sources`, `get_content_impact` (what a live page earns), `get_content_draft_package` (a draft ready for a CMS). Changes: `generate_content_brief` (an AI call that replaces the existing brief), `update_opportunity_status`, `create_content_draft`, `suggest_content_changes`, `add_content_source`, `set_content_draft_ready`, `mark_content_draft_published`. Ansvisor never publishes a page: a person does, and drafts and suggestions wait for a person in the editor.

**Site Audit**: `list_site_audits`, `get_site_audit`, `get_site_audit_quota`. Change: `run_site_audit` uses one monthly credit and runs in the background. Poll `get_site_audit` until it is completed.

**Action Center**: `list_actions`, `get_action`, `list_signals`, `list_action_history`, `get_action_scorecard`, `list_task_reviews`. Changes: `update_task_status` (records work a person did; it doesn't do it), `create_improve_action`, `approve_task_review`, `dismiss_task_review`.

**Product Visibility (shopping)**: `list_shopping_cards`, `get_product_visibility`, `get_catalog_sources`, `list_catalog_products`, `get_shopping_shelf`, `get_shopping_readiness`, `get_product_ai_says`.

## Plans and roles

On Ansvisor Cloud:

- Reading works on every plan, the free trial included.
- Changes, runs and anything that uses credits need the Growth plan or above, paid. On Starter and in the free trial, those tools answer `plan_required`. Tell the person they need Growth; an admin can upgrade in Settings › Billing.
- A workspace whose plan has ended is read-only: changes answer `subscription_inactive`.
- Signing in (instead of an API key) needs a paid plan. In the free trial, or once the plan has ended, every tool answers `oauth_plan_required` over a sign-in connection. Tell the person an API key from Settings › MCP & API Keys can still read.
- Some tools also need a feature of a higher plan, such as shopping analytics or Improve, and say so when the plan doesn't include it.

A self-hosted Ansvisor has every feature and no plan limits.

Some tools are for admins and managers only: accepting topic or prompt suggestions, dismissing a topic suggestion or an opportunity, the tasks waiting for review (listing them too), correcting a response's sentiment, content briefs and Improve actions. Dismissing a prompt suggestion is open to analysts too. Each of these says so in its description and refuses other roles, naming the role it needs: check `get_me` before you suggest one.
