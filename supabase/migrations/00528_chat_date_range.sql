-- ============================================================================
-- 00528: Chat's date range — the person's default, and the card that asks it
-- ============================================================================
-- Owner request 2026-11-11: before the first analysis that reads data, Chat
-- asks which time range to use (Last 24 hours, Last 7 days, Last 30 days,
-- Last 90 days, or two days picked), and keeps the answer as the person's
-- default from then on: in the main Chat and in the side panel alike, for
-- every brand. A short message ("last 7d", "son 7d") changes it, and so does
-- Chat Settings or the line under the message box.
--
--   * chat_user_prefs.date_range: the person's default range, as the app's
--     date control names its presets ('24h', '7d', '30d', '90d'), or two
--     days, first and last ('2026-10-01/2026-10-15'). Null: not picked yet,
--     so Chat asks on the next analysis that reads data. The person reads
--     and writes their own row (00400's policies and table grants cover the
--     new column); the engine writes it with the service role when the
--     person answers its card or sends a short range.
--   * chat_ask_options_valid: a question card may have 2–5 options, one
--     more than before. The range card offers the page's own range first
--     when the side panel is open on a page with a custom range, then the
--     four presets. The model's questions are still held to 4 by the server
--     (asks.ts askToolInput); the rest of the rule is 00417's.

alter table public.chat_user_prefs
  add column if not exists date_range text check (
    date_range ~ '^(24h|7d|30d|90d|[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2})$'
    and (
      position('/' in date_range) = 0
      or split_part(date_range, '/', 1) <= split_part(date_range, '/', 2)
    )
  );

comment on column public.chat_user_prefs.date_range is
  'Chat''s date range (00528): the period a read covers when the person names none, as a preset (24h, 7d, 30d, 90d) or two days (YYYY-MM-DD/YYYY-MM-DD). Null: Chat asks before the next analysis that reads data.';

-- Whether a question's options are 2–5 rows, each with a label, exactly one
-- of them Recommended (CHAT-07 Data notes; 5 for the range card, 00528).
create or replace function public.chat_ask_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_options) <> 'array' then false
    when jsonb_array_length(p_options) not between 2 and 5 then false
    else coalesce(
      (
        select bool_and(
            jsonb_typeof(o) = 'object'
            and jsonb_typeof(o -> 'label') = 'string'
            and char_length(o ->> 'label') between 1 and 120
          )
          and count(*) filter (where o -> 'recommended' = 'true'::jsonb) = 1
        from jsonb_array_elements(p_options) as t(o)
      ),
      false
    )
  end;
$$;
