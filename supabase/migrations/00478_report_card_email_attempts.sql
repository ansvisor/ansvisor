-- A report card's e-mail the web couldn't draw a PDF for is tried again on
-- the next sweep (server/src/lib/report-card/deliver.js): how many times it
-- was tried, so it gives up after a cap and waits behind the e-mails not yet
-- tried instead of filling every sweep.

alter table public.report_card_requests
  add column if not exists email_attempts integer not null default 0
    check (email_attempts >= 0);
