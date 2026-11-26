---
title: Export a filtered view to Google Sheets
route: /dashboard/settings/integrations
keywords: [google sheets, export, spreadsheet, filtered rows]
synonyms: [export prompts, export citations, export opportunities]
plan: all
updated: 2026-11-26
last_checked: 2026-11-26
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/src/components/google-sheets-export.tsx]
---

Export the rows and columns of a filtered Tracked Prompts, Citations or Content Opportunities report to Google Sheets.

## Connect Google Sheets

An admin or manager can connect Google Sheets in **Settings > Integrations**. In **Brand settings > Integrations**, choose the sign-in for the brand, connect another account or reuse a sign-in shared with another brand. On a self-hosted installation, the card shows when Google Sheets needs configuration.

## Export a report

Anyone with access to the brand can apply filters and choose **Export to Google Sheets**. Leave the address empty to create a spreadsheet in the connected account's Drive, or paste an editable spreadsheet's address. Writing to an existing spreadsheet requires access to all brands using that sign-in. Each export makes a new tab. Choose **Open exported sheet** to see the result. The next export from the same view offers the last spreadsheet used in this browser for this brand and sign-in.
