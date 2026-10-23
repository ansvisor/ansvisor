-- ============================================================================
-- 00253: the pages a Content Editor draft links to, read once a day
-- (Content Editor Quality, Trust)
-- ============================================================================
-- Trust's "No broken links" and "Fresh sources (≤ 24 months)" (Quality spec
-- §2.2) read each link the page has: does it answer, and how old is the page
-- it points to. The server reads a link at most once a day, whoever's draft
-- has it; this is that read. It holds only what any visitor of the linked
-- page sees, so it is shared, and only the server touches it (no policies).
--
--   * status: 'ok' (it answers, a page or a file), 'broken' (gone, refused,
--     or nowhere), 'unknown' (it wouldn't tell: slow, a bot wall, a server
--     error that may pass).
--   * page_date: the newest date the page gives for itself (JSON-LD
--     datePublished / dateModified, <time datetime>, article:* meta), or null.

create table if not exists public.content_link_checks (
  url text primary key check (char_length(url) <= 2048),
  status text not null check (status in ('ok', 'broken', 'unknown')),
  http_status integer,
  page_date timestamptz,
  checked_at timestamptz not null default now()
);

create index if not exists content_link_checks_checked_at
  on public.content_link_checks (checked_at);

alter table public.content_link_checks enable row level security;

comment on table public.content_link_checks is
  'Content Editor Quality (Trust): each linked page''s last read — answers or not, and its newest date. Server only; read at most once a day.';
