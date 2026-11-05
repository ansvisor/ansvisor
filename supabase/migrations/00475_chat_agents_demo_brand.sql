-- ============================================================================
-- 00475: the demo brand's sample agents
-- ============================================================================
-- An agent belongs to the workspace, not to a brand (00419), so the demo
-- brand's sample agents (demo Agent Center: the server's lib/demo/agents.js)
-- carry the demo brand they show. The web leaves them out of whatever runs,
-- counts or pauses agents (the triggers, the sweep, the plan's active
-- agents), and no change of a person reaches them (agentForAct refuses
-- demo_brand). They go with the demo brand (on delete cascade) and when it
-- is hidden, and a rebuild finds them by it. Null for every agent a person
-- makes.
--
-- The column only ever names a demo brand of the agent's own workspace
-- (the trigger below), so a real agent can never be marked by mistake and
-- left out of its own workspace's runs.

alter table public.chat_agents
  add column if not exists demo_brand_id uuid references public.brands(id) on delete cascade;

comment on column public.chat_agents.demo_brand_id is
  'The demo brand whose sample agent this is (demo Agent Center); null for an agent a person made. Such an agent never runs, counts toward the plan or pauses.';

create index if not exists chat_agents_demo_brand_idx
  on public.chat_agents (demo_brand_id)
  where demo_brand_id is not null;

create or replace function public.check_chat_agent_demo_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.demo_brand_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.brands b
    where b.id = new.demo_brand_id
      and b.organization_id = new.organization_id
      and b.is_demo
  ) then
    raise exception 'an agent''s demo_brand_id must be a demo brand of its workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_agents_check_demo_brand on public.chat_agents;
create trigger chat_agents_check_demo_brand
  before insert or update of demo_brand_id, organization_id on public.chat_agents
  for each row execute function public.check_chat_agent_demo_brand();
