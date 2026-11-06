-- ============================================================================
-- 00491: IndexNow, telling search engines a page went live (#2142, part B)
-- ============================================================================
-- When Send to CMS confirms a page live, Ansvisor tells IndexNow (Bing,
-- Yandex, Seznam, Naver and the others that share it; Bing's index feeds
-- Microsoft Copilot) once. IndexNow trusts a site by a key file at its root,
-- https://<host>/<key>.txt, on the same host as the pages. Ansvisor can't put
-- a file on a brand's site, so a brand turns it on in Settings ›
-- Integrations: Ansvisor makes the key, the person puts the file on the
-- site, and Check reads it back.
--
--   * brands.indexnow_key: the brand's key, 32 hex characters; null: off.
--     It isn't a secret (the file is public), so members read it with the
--     brand. Only the server writes it, for admins and managers.
--   * brands.indexnow_host: the host the file is on (the brand's primary
--     domain when it was turned on). Only pages on this host are announced.
--   * brands.indexnow_verified_at: when Check found the key at its address;
--     null until then, and nothing is announced.
--   * content_drafts.indexnow_pinged_at: when the page was announced, kept
--     before the call, so a page is announced once however often it is read
--     as live. A failed call is logged and never tried again.

alter table public.brands
  add column if not exists indexnow_key text
    check (indexnow_key is null or indexnow_key ~ '^[a-f0-9]{32}$'),
  add column if not exists indexnow_host text
    check (
      indexnow_host is null
      or (char_length(indexnow_host) <= 253 and indexnow_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$')
    ),
  add column if not exists indexnow_verified_at timestamptz;

alter table public.content_drafts
  add column if not exists indexnow_pinged_at timestamptz;

comment on column public.brands.indexnow_key is
  'IndexNow (00491): the brand''s key, its file at https://<indexnow_host>/<key>.txt; null: off. Not a secret.';
comment on column public.brands.indexnow_host is
  'IndexNow (00491): the host the key file is on; only pages on it are announced.';
comment on column public.brands.indexnow_verified_at is
  'IndexNow (00491): when Check found the key file; null: nothing is announced.';
comment on column public.content_drafts.indexnow_pinged_at is
  'IndexNow (00491): when the page, live through Send to CMS, was announced; once per page.';

-- ----------------------------------------------------------------------------
-- When a page was announced is the server's, as published_at is: 00289's
-- guard, with indexnow_pinged_at, so a member can't clear it (announcing the
-- page again) or set it ahead (never announcing it).
-- ----------------------------------------------------------------------------
create or replace function public.guard_content_draft_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A role that bypasses RLS is server-side (service role, migrations).
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.score_before is not null or new.score_after is not null then
      raise exception 'content draft scores are set server-side'
        using errcode = '42501';
    end if;
    if new.action_id is not null then
      raise exception 'content draft action is set server-side'
        using errcode = '42501';
    end if;
    if new.agent_state is not null or new.agent_state_at is not null
       or new.agent_run is not null then
      raise exception 'content draft agent state is set server-side'
        using errcode = '42501';
    end if;
    if new.published_url is not null or new.published_at is not null then
      raise exception 'content draft live address is set server-side'
        using errcode = '42501';
    end if;
    if new.restored_at is not null then
      raise exception 'content draft restore time is set server-side'
        using errcode = '42501';
    end if;
    if new.indexnow_pinged_at is not null then
      raise exception 'content draft IndexNow time is set server-side'
        using errcode = '42501';
    end if;
  elsif new.brand_id is distinct from old.brand_id
     or new.author is distinct from old.author
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.score_before is distinct from old.score_before
     or new.score_after is distinct from old.score_after
     or new.action_id is distinct from old.action_id
     or new.agent_state is distinct from old.agent_state
     or new.agent_state_at is distinct from old.agent_state_at
     or new.agent_run is distinct from old.agent_run
     or new.published_url is distinct from old.published_url
     or new.published_at is distinct from old.published_at
     or new.restored_at is distinct from old.restored_at
     or new.indexnow_pinged_at is distinct from old.indexnow_pinged_at
  then
    raise exception 'content draft column is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
