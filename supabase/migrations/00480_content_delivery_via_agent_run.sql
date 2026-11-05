-- ============================================================================
-- 00480: a CMS send a person approved on an agent run's card
-- ============================================================================
-- CHAT-22 §2 item 2 and CHAT-21 §I item 44: a shipped change links to the
-- agent run it came from, also when a person clicked to send it ("agent
-- run, you approved", mockup signature #f-impact). An agent's own send
-- (00444, agent_run_id) already does; a send from the Approve or Send click
-- on a card in an agent run's chat named no run, so the impact ledger and
-- the run's outcome never counted it.
--
--   * via_agent_run_id: the agent run whose card a person sent or published
--     the page from (Chat's push_cms_draft, publish_cms and
--     trigger_content_webhook, on the click). The server checks the run is
--     the workspace's and the brand's before it keeps it. sent_by stays the
--     person who clicked; the ship event names the agent and its run and
--     stays assisted (ship.js agentOrigin). A send from the Content Editor
--     or the Library, later or not, names none.
--   * agent_run_id keeps meaning "sent on its own" (the Library's "Sent by
--     {agent} · on its own"): a send is one or the other, never both.
--
-- Members read it with the send (00262, 00390); only the server writes it.

alter table public.content_draft_deliveries
  add column if not exists via_agent_run_id uuid
    references public.chat_agent_runs(id) on delete set null;

create index if not exists content_draft_deliveries_via_agent_run_idx
  on public.content_draft_deliveries (via_agent_run_id)
  where via_agent_run_id is not null;

alter table public.content_draft_deliveries
  drop constraint if exists content_draft_deliveries_one_agent_run_check;
alter table public.content_draft_deliveries
  add constraint content_draft_deliveries_one_agent_run_check
    check (agent_run_id is null or via_agent_run_id is null);

comment on column public.content_draft_deliveries.via_agent_run_id is
  'The agent run whose card a person sent the page from (00480): the ship event names that run and its agent, assisted. Null for an agent''s own send (agent_run_id) and for a send from the Content Editor or the Library.';

notify pgrst, 'reload schema';
