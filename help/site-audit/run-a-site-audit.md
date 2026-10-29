---
title: Run a site audit
route: /dashboard/audit
keywords: [site audit, run audit, audit a page, auto-audit, audit settings]
synonyms: [page audit, check my page, scan a page, AI readiness check]
plan: all
updated: 2026-10-29
last_checked: 2026-10-29
owner: Cihan
app_version: 0.3.0
approved: false
sources: [docs/guides/site-audit.mdx]
---
**Site Audit** checks how ready a page is to be cited by AI answer engines. It fetches the page, runs 48 signals in five categories, scores the page out of 100 and writes fixes for what failed. You find it in the sidebar under **Execution**, after **Content**. It is on every plan.

## Start an audit

The field at the top of the Site Audit page is filled in with your brand's primary domain. Replace it with the page you want to check and click **Run Audit**.

You can audit any page: your own, or a competitor's page to see what it does better. Audits of other sites are listed with your pages but kept out of your site's score.

## While it runs

The report opens right away and follows the audit through its stages: **Fetching the page…**, **Analyzing 48 signals…** and **Generating AI recommendations…**. An audit usually takes about 30 seconds. If it is still running after two minutes, the page says **This audit is taking longer than expected.** Click **Check again** to look again.

## Other ways to start an audit

- **Audit selected** on the **Opportunities** tab;
- **Re-audit** on the pages you select on the **Pages** tab;
- **Audit page** on a landing page of the **AI Referral Traffic** page;
- the re-run icon at the top of a report, to audit the same page again;
- auto-audit, which audits your top-priority pages on its own.

Audits started in bulk run a few at a time.

## Your monthly audits

Each completed audit uses one of your plan's monthly audits. An audit still running already counts; a failed one doesn't. The **Audits this month** card shows what's left. Self-hosted instances have no monthly limit.

## How auto-audit works

Auto-audit spends a quarter of your monthly audits on the top pages of the **Opportunities** tab, in five runs on days 1, 7, 14, 21 and 28 of your billing month.

Pages you fixed go first: a page whose Site Audit fix you completed in the Action Center in the last 30 days, and that hasn't been audited since, so the action's result says whether the fix took. Pinned pages come next. Pages audited in the last 30 days wait for a later run. After a run, a notice sums it up with **View pages**, and its audits show **Auto** in the Pages list.

## Site Audit settings

**Settings**, at the top right of the Site Audit page, holds:

- **Auto-audit**: on or off for every brand in your organization. Turned off, all your monthly audits are yours to spend.
- **E-mail the team after each run**: a summary e-mail after each auto-audit run.
- **Excluded pages**: one path per line, where an asterisk stands for anything. These pages stay out of Opportunities and auto-audits.
- **Pinned pages**: the pages you pinned from Opportunities, with **Unpin**.

Only admins and managers can change these settings; other members see them read-only.
