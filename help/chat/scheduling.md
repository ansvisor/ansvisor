---
title: Schedule work in Chat
route: /dashboard/chat/scheduled
keywords: [schedule, scheduled job, scheduled page, every monday, recurring report, ready by, create schedule, repeat, run now, take over, no change, didn't run, paused, job time zone]
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
- **When**: a day and time, or a repeat. The line under it says how Chat read it, with your time zone and the next run. A day with no time runs at 09:00. The time zone is the one in **Settings › Account › Time zone**, or your browser's while that is **Automatic**.
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

## Results and notices

Each run posts its result in the job's own chat, and the chat shows up in your **Inbox** as a new result. When a job makes several things, such as drafts for three tasks, the job shows how many are ready.

With **Notify only if the answer changed**, a run that reads the same data as the last result stops before writing and says **No change**. Nothing new is sent or saved, and the writing step uses none of your AI limit. The first run always delivers.

If a run fails, Chat tries again 10 minutes later. If that fails too, the top of your **Inbox** says the job didn't run and why. A job that stops by itself, such as at your monthly AI limit or after 3 failed runs in a row, says so there too. The note goes away once the job runs again.

## The Scheduled page

**Scheduled**, in the Chat menu with the number of your jobs that are on, lists the work Chat does on a date or on repeat. Each row shows the job, when it runs, its last run, where its result goes and its mode, with a switch to turn it on or off. A job turned back on runs from now on: missed runs aren't made up. Your agents' schedules are listed too, with **Edit** in Agent Center.

**New schedule** opens a new chat with "Every Monday at 9:00, " ready to finish.

## A job's page

Click a job to change its name, what Chat does each run, **When** (the next three runs show as you type), its **Time zone**, where results go and **Notify only if the answer changed**, then **Save**. A job keeps its own time zone: changing yours in Settings doesn't move it. The page also has **Run now**, **Delete** (past results stay in Files) and the last 20 runs, with the share of your monthly AI usage each one took.

## Who sees what

You see your own jobs. Admins see every job in the workspace, and can turn any of them off or delete them; only a job's creator edits it or runs it now, because its runs act as them. When someone can no longer run their job, for example after leaving the workspace, it pauses until an Admin clicks **Take over**.
