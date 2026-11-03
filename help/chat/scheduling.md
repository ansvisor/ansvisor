---
title: Schedule work in Chat
route: /dashboard/chat
keywords: [schedule, scheduled job, every monday, recurring report, ready by, create schedule, repeat]
synonyms: [run later, run on repeat, weekly report automatically, remind me, automate a chat]
plan: all
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, help/chat/skills.md]
---
Chat can do work by itself later or on repeat. Ask in any chat, such as "Every Monday at 9:00, send me the weekly report" or "Have a citations check ready by Friday". Chat never schedules anything without your click: it shows a card first, and the job is made only when you click **Create schedule**.

## The schedule card

The card shows the job as it will be made, and you can change it before you click:

- **Job**: the job's name.
- **What Chat does each run**: what Chat is asked each time, or the skill it runs.
- **When**: a day and time, or a repeat. The line under it says how Chat read it, with your time zone and the next run. A day with no time runs at 09:00.
- **Deliver to**: **Chat**, **Email** or **Chat + Email**.
- **Notify only if the answer changed**: for jobs that repeat.

Under the fields, the card says each run uses Auto · Normal and about how much of your monthly AI usage a run takes. **Cancel** makes nothing.

## How Chat reads the date

Chat reads phrases such as "every Monday at 9:00", "every weekday", "1st of every month", "tomorrow at 3pm", "in 7 days" and "in 3 working days". Days count as calendar days unless you say working days, which are Monday to Friday.

"Ready by Friday" starts the work right away and shows when it is due. A job repeats at most once a day.

When a phrase could mean two dates, such as "next Friday", Chat asks which one you mean instead of guessing. A time that has passed isn't scheduled.

## After you create it

The steps above the answer show **Scheduled:** with the job's name, when it runs and where results go. Each run works in the job's own chat, as you, with your access checked again at every run.

Only Admins and Managers can schedule work. Your plan sets how many scheduled jobs can be on at once.
