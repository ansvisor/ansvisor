---
title: Get scheduled results by email
route: /dashboard/chat
keywords: [scheduled email, email results, report by email, pdf attachment, deliver to email, didn't run email]
synonyms: [send me the report, email me every monday, scheduled report email, results in my inbox]
plan: all
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, help/chat/scheduling.md]
---
A scheduled job can send its results by email as well as to Chat. On the schedule card, set **Deliver to** to **Email** or **Chat + Email** before you click **Create schedule**.

## Who gets the email

The email goes to the person who made the job, and to teammates from your workspace the job names. It never goes to an address outside your workspace by itself.

Before each email is sent, Ansvisor checks again that each person still belongs to the workspace and can still see the job's brand. Anyone who can't is left out of that email.

## What the email says

The email has the job's name and the first few lines of its result. **Open in Chat** opens the full result, and **Pause this job** opens the job so you can turn it off. Both ask you to sign in.

When the result fits in a PDF of 5 MB or less, the PDF is attached. A bigger result comes as the **Open in Chat** link only. A run that finds **No change** sends no email.

If your workspace has a white label kit with a company name, the email comes from that name instead of Ansvisor.

## When a job didn't run

If a run fails and the retry 10 minutes later fails too, the email says the job didn't run and why, with **Retry**. A job that stops by itself, such as at your monthly AI limit, sends an email that says it is paused and why.
