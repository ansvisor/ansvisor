-- ============================================================================
-- 00247: a whole-page suggestion (Content Editor, Rewrite the page to these rules)
-- ============================================================================
-- Apply rules with Agent leaves at most 8 small edits a run, which can't
-- bring a 19,000-character page to an 8,000-character Length (about 2% a
-- run on prod, 2026-10-23). Rewrite the page to these rules has the Content
-- Agent rewrite the whole page in one call, left as ONE suggestion the
-- person compares with their page and accepts or rejects:
--
--   * kind 'page': after_text is the whole page's HTML, up to 500,000
--     characters (the editor's body limit), not 20,000;
--   * before_html: the page as the agent read it, which the editor checks
--     the page against before applying it and puts back on Undo. A page
--     suggestion has it; the others don't;
--   * before_text stays '' for it, as for an insert.
--
-- Rows are still written by the server only; the decide RPC (00217) and
-- RLS are unchanged.

alter table public.content_draft_suggestions
  add column if not exists before_html text;

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_kind_check,
  add constraint content_draft_suggestions_kind_check
    check (kind in ('replace', 'insert', 'page'));

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_after_text_check,
  add constraint content_draft_suggestions_after_text_check
    check (char_length(after_text) between 1 and case when kind = 'page' then 500000 else 20000 end);

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_check,
  add constraint content_draft_suggestions_check
    check (kind in ('insert', 'page') or before_text <> '');

alter table public.content_draft_suggestions
  drop constraint if exists content_draft_suggestions_before_html_check,
  add constraint content_draft_suggestions_before_html_check
    check ((kind = 'page') = (before_html is not null)
           and char_length(coalesce(before_html, '')) <= 500000);

comment on column public.content_draft_suggestions.before_html is
  'A page suggestion''s page as the agent read it (kind ''page'', 00247): checked against the editor''s page before applying, and put back on Undo. Null for the others.';
