-- ============================================================================
-- 00468: a person's own time zone (Settings › Account)
-- ============================================================================
-- profiles.time_zone: the IANA time zone the person picked in Settings ›
-- Account; null is Automatic, their browser's. Theirs to set, on their own
-- row ("profiles: own row update", 00001): 00228's guard keeps role and
-- organization with the server and leaves this column to the person.
--
-- What reads it, in this order: the person's pick, else their browser's zone,
-- else UTC (web lib/time-zone.ts effectiveTimeZone):
--   * a Chat run's zone: the times it shows and a schedule card's zone, so a
--     new scheduled job is made on it;
--   * the morning a person's daily suggestions are sent in (server
--     chat-suggestions).
-- A scheduled job keeps the zone it was made with (chat_schedules.timezone,
-- 00457): a change here moves no job.

alter table public.profiles
  add column if not exists time_zone text
    constraint profiles_time_zone_format check (
      time_zone is null
      or (
        char_length(time_zone) between 1 and 64
        and time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
      )
    );

comment on column public.profiles.time_zone is
  'The IANA time zone the person picked (Settings › Account); null = Automatic, their browser''s. New Chat runs, schedule cards and daily suggestions use it; existing scheduled jobs keep their own.';

-- The format check above can't ask the database's own list of zones; this
-- does, so a name that only looks like a zone ("Europe/Nowhere") is refused.
create or replace function public.check_profile_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.time_zone is not null
     and not exists (
       select 1 from pg_catalog.pg_timezone_names z where z.name = new.time_zone
     )
  then
    raise exception 'profile time zone is not one the database knows'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_check_time_zone on public.profiles;
create trigger profiles_check_time_zone
  before insert or update of time_zone on public.profiles
  for each row execute function public.check_profile_time_zone();
