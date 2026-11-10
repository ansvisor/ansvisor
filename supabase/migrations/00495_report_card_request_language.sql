-- ============================================================================
-- 00495: the language a report card request's PDF and e-mail are written in
-- ============================================================================
-- The free report card's form on www.ansvisor.com may choose the report's
-- language (owner decision 2026-11-09): English, Turkish, French, Spanish,
-- German, Portuguese, Italian or Dutch. The questions are still asked in the
-- target country's main language (report_cards.language, 00472), so the
-- card's figures and cost don't change: only the words of its PDF and e-mail
-- do. The PDF isn't kept but drawn for each e-mail (server
-- lib/report-card/deliver.js), so the language is the request's, not the
-- card's: two people at one company may get the same card in two languages.
--
-- Null is the form's "Auto": Turkish for a Türkiye card, English elsewhere,
-- as before. The check is on the code's form (ISO 639-1), not a list, so a
-- language added later needs no migration; the API checks the code against
-- the languages it writes.

alter table public.report_card_requests
  add column if not exists report_language text
    check (report_language ~ '^[a-z]{2}$');

comment on column public.report_card_requests.report_language is
  'The language the request''s PDF and e-mail are written in, as the form chose it (ISO 639-1; 00495); null: by the card''s country, Turkish for TR and English elsewhere.';
