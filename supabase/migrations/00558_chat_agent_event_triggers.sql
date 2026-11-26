-- Chat (00558): two event triggers for agents, beside When a brand is added
-- (00482):
--   * page_published: a Content page went live in the brand's CMS (Send to
--     CMS, content-published.js). The API server tells the web once the
--     page is live; pages an agent's run made don't fire it, so an agent
--     that writes pages never starts itself again.
--   * catalog_synced: a sync of one of the brand's product catalog sources
--     finished and changed its products (catalog/sources.js).
-- Each fires an active agent whose scope has the brand, once per agent and
-- event, with the noise rules every event trigger has (cooldown, daily
-- limit, AI limit). The run acts as the agent's owner, as every triggered
-- run does (CHAT-21 §H item 38). Schema only: nothing is backfilled.
--
-- DEPLOY THE WEB FIRST, THEN APPLY THIS. The claims' primary key gains
-- `ref` below. The web before this PR claims a brand added with
-- "on conflict (agent_id, kind, brand_id)", which no longer matches a
-- constraint once this is in: its brand_added fires would fail until the
-- new web is live. The new web claims on the primary key, whichever it is
-- (agent-triggers.ts claimOnce), so it works before and after this file.

-- ─── The kinds ──────────────────────────────────────────────────────────────

-- A trigger of the new kinds. Their settings are empty: they have none.
alter table public.chat_agent_triggers
  drop constraint if exists chat_agent_triggers_kind_check;
alter table public.chat_agent_triggers
  add constraint chat_agent_triggers_kind_check
    check (
      kind in (
        'schedule', 'signal', 'kpi', 'watch_rule', 'brand_added', 'page_published', 'catalog_synced'
      )
    );

-- A run they started. Every kind 00482 allows stays.
alter table public.chat_agent_runs
  drop constraint if exists chat_agent_runs_trigger_kind_check;
alter table public.chat_agent_runs
  add constraint chat_agent_runs_trigger_kind_check
    check (
      trigger_kind in (
        'schedule', 'signal', 'kpi', 'watch_rule', 'brand_added', 'page_published',
        'catalog_synced', 'manual', 'action', 'agent'
      )
    );

-- ─── Once per agent and event ───────────────────────────────────────────────

-- 00482's claims, one per agent, kind and brand, now also by the event
-- that fired: a page's send, a catalog source's sync. A brand added has
-- one event per brand, its ref ''. The table holds a row per fire so far:
-- small, so the new key builds at once.
alter table public.chat_agent_trigger_claims
  add column if not exists ref text not null default '';

alter table public.chat_agent_trigger_claims
  drop constraint if exists chat_agent_trigger_claims_ref_check;
alter table public.chat_agent_trigger_claims
  add constraint chat_agent_trigger_claims_ref_check check (char_length(ref) <= 200);

alter table public.chat_agent_trigger_claims
  drop constraint if exists chat_agent_trigger_claims_kind_check;
alter table public.chat_agent_trigger_claims
  add constraint chat_agent_trigger_claims_kind_check
    check (kind in ('brand_added', 'page_published', 'catalog_synced'));

alter table public.chat_agent_trigger_claims
  drop constraint if exists chat_agent_trigger_claims_pkey;
alter table public.chat_agent_trigger_claims
  add constraint chat_agent_trigger_claims_pkey primary key (agent_id, kind, brand_id, ref);

comment on column public.chat_agent_trigger_claims.ref is
  'Chat (00558): the event that fired: a send''s id (page_published), a catalog source''s id and sync time (catalog_synced); '''' for brand_added, whose event is the brand itself.';

comment on table public.chat_agent_trigger_claims is
  'Chat (00482, 00558): the fires an agent''s event trigger makes once (brand_added: once per brand; page_published, catalog_synced: once per event), one row per agent, kind, brand and event, so an event never fires the same agent twice. Readable where the agent and the brand are; the server writes.';
