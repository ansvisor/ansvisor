---
title: Generate visibility reports
route: /dashboard/reports
keywords: [reports, generate report, report templates, PDF, executive summary, snapshot, site audit score, mention evidence, newest first]
synonyms: [monthly report, client report, export a report, download PDF, report for my boss, score range, plus or minus]
plan: all
updated: 2026-11-19
last_checked: 2026-11-19
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/reports.mdx]
---
The **Reports** page makes point-in-time snapshots of your brand's AI visibility. Unlike the live dashboards, a report never changes: its numbers are captured when it is generated and stay the same as new tracking results arrive. That makes it the right tool for a monthly review, a client deliverable, or a before-and-after comparison around a campaign.

## Generate a report

Click **Generate Report** and pick a template. A template is a default set of sections, and you can switch any section on or off before generating. The template sets the **Date Range** right under it (last 7, 30 or 90 days, or Custom); change it there if you like. Then pick the **Brand**, check the **Sections** and give the report a title if you like. **Generate Report** stays at the bottom of the window as you scroll. Without a title, a report is named after its template, such as Weekly Visibility Summary; its period shows beside it. Generated reports appear under **Generated Reports** on the same page, newest first.

When the brand already has a report of the same template and days, **Generate Report** asks first: **Open it** opens that report, **Generate anyway** makes a second one.

## Rename or delete a report

Admins and Managers can rename a report: open its **⋯** menu, choose **Rename**, type the new name and click **Save**. Only the name changes, never the report's numbers. To delete one, open its **⋯** menu, choose **Delete report** and confirm.

## Share or download from the list

Each report's **⋯** menu also has **Copy link** and **Download PDF**. **Copy link** copies the report's address: it opens the report for people in your workspace, who sign in to see it. Reports have no public link, so to send one to a client, download the PDF. **Download PDF** saves the same PDF as the report's own page, with your white label kit if you use one.

## Templates

- **Weekly Visibility Summary**: KPIs, Trend and Share of Voice, over the last 7 days.
- **Monthly Executive Report**: every section, over the last 30 days.
- **Competitor Benchmark**: KPIs, Share of Voice, Competitors and Topics, over the last 30 days.
- **Citation & Sources Report**: Citations and Citation Evidence, over the last 30 days.

## Sections

The full picker offers KPIs, Trend, Share of Voice, Competitors, Topics, Prompts, Mention Evidence, Fan-out, AI Traffic, AI-sourced pipeline, Product Visibility, Audit Score, Citations and Citation Evidence. **Product Visibility** appears only for brands with Shopping mode on. **AI-sourced pipeline** comes with the Growth plan and above. The AI executive summary is always included: it isn't a section you pick. If it can't be written, the report is saved with its figures and no summary. A section that can't be gathered is tried once more; if it still fails, the report is saved without it and doesn't mention it, so nothing in it tells a client data is missing. Admins see a short note about it above the report, which the PDF leaves out.

## Read a report

A report opens with its **Executive Summary**: a short account of what changed versus the previous period, such as the headline visibility movement, mention and citation growth, and sentiment and competitor shifts. Its headline is your **Visibility score**, out of 100 with no % sign, and it calls the share of prompts that named or cited you **Prompts with a mention**. It names AI platforms as the rest of Ansvisor does, such as **Gemini**. One card per selected section follows, in a fixed order. Each metric is compared with the previous period of equal length, so a 30-day report is compared with the 30 days before it; **Site Audit Score** is the exception. Percentage changes read +X%, and point changes for visibility and sentiment +X pts. Because the snapshot is frozen, a report's numbers can differ from the live dashboards.

## Mention Evidence

Mention Evidence lists the answers that mentioned you most in the period, newest first. Each row shows the prompt, the platform, the date and the passage around your name, as plain text without the answer's formatting. Reports made earlier read the same way.

## Site Audit Score

**Site Audit Score** shows your latest audit of one page as of the report's end date, scored 0 to 100 as in Site Audit, with the change in points since that page's audit before it. It isn't compared with the previous period. Once the page has three audits by the end date, the score shows its range, such as **64 ± 2**, worked out as in Site Audit's report: half the gap between the lowest and highest score of its last five audits. A line below gives those two scores. Reports made before the range was added don't show it.

## KPIs and the leaderboard

The KPI row leads with your **Visibility score**, out of 100, such as **15.5/100**, never with a % sign. It blends how often AI answers mention you, how often they cite your site and how early they name you. Next to it, **Prompts with a mention** is the share of the period's answered prompts whose answers named or cited you, with the counts under it, such as **112 of 308 prompts**. **Mentions**, **Brand Citations** and **Positive Sentiment** follow. The older **Avg. Score** is no longer shown.

In the **Competitor Leaderboard**, the **Visibility score** column shows each brand's score with its prompts with a mention under it, and **Change** is the score's change in points. A report saved before a figure existed shows only the figures it has.

## AI-sourced pipeline

**AI-sourced pipeline** shows the HubSpot contacts, deals and revenue that came from AI answers in the period, as on the AI Traffic page: AI-sourced contacts and won revenue against the previous period, AI-influenced deals, open pipeline, the top AI engines and landing pages, and HubSpot's own AI Referrals contacts on a line of their own. A report includes it only for a brand that connected HubSpot with **Mark contacts who came from an AI answer** on, once HubSpot has been read.

## Download a PDF

**Download PDF** saves the report as a PDF with the same sections as the web view, the executive summary included. Its text stays selectable and sharp at any zoom, and the file is small enough to attach to an email. With white label in use, the report and its PDF carry your agency's logo, color, name and footer instead of Ansvisor's, with a "Prepared for" cover.

Counts in a report and its PDF, such as mentions, citations and visits, are written with thousands separators in your interface language: **10,262** in English.

## Competitor Leaderboard ranking

The **Competitor Leaderboard** ranks brands by **Visibility score**, highest first. A brand named in fewer than 10 of the period's prompts isn't ranked: a score from so few answers says little. Such brands are listed after the ranked ones with a **Low sample** tag, in the report and its PDF. Reports made before the score existed are listed by their own figure.
