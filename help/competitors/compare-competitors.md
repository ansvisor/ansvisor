---
title: Compare your AI visibility with competitors
route: /dashboard/competitors
keywords: [competitors, head-to-head, competitor comparison, gaps, strengths, platform breakdown, prompt-by-prompt, competitor types]
synonyms: [benchmark competitors, how do we compare, competitor visibility, us versus them, competitor score, filter competitors, group competitors]
plan: all
updated: 2026-11-19
last_checked: 2026-11-19
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/competitors.mdx, docs/concepts/visibility-scoring.mdx]
---
The **Competitors** page, under **Analytics** in the sidebar, right after **Visibility**, compares the AI visibility of the competitors you track with yours, across your tracked prompts and AI platforms. You can also open it with **Head-to-Head** on the **Leaderboard** card of **Visibility**, or by clicking a competitor's name there. **Tracked Competitors** lists them with their visibility; select one to see it head-to-head with your brand.

## Tracked Competitors

The **Tracked Competitors** card lists every competitor with its logo (its site's icon or initials), its domain and:

- its AI Visibility Score from 0 to 100, the same score as on the Visibility page's leaderboard: how often answers name it, cite its site, and how early it's named. Hover it for its answers, citations and position factor.
- the prompts it's visible in, out of the prompts with answers in the window, such as 12/40 prompts.

**No data** means no answer in the window was measured for that competitor yet, such as one you've just added.

The **Date Range** under the page's title (7d, 30d by default, 90d, All or Custom) sets the window for these scores, and the line under the list says which days they cover, such as "Scores cover the last 7 days." **Export CSV** on the card downloads every brand's scores, visible prompts, mentions and citations.

## Order and rank

The cards run from the highest score to the lowest, each with its rank, such as **#2**. Your brand sits among them as **You**, in its place. One named in fewer than 10 prompts in the window shows **Low sample** and no rank, after the ranked ones.

## Filter and group by type

Once one of your competitors has a type, each card shows it under the domain, and two controls sit above the list:

- the type menu, **All types** at first, shows only the competitors of one type, or those with **No type**;
- **Group by type** lists them under a heading per type, with how many each has, the ones without a type last.

They only change which cards show and in what order: scores, the date range and the head-to-head stay as they are. **Export CSV** has a type column. Setting a type is in **Add competitors to track**.

## Open a head-to-head comparison

Click a competitor's card to compare it with your brand under **Your brand vs competitor**, with both names filled in. The selected card has a dark border. Click the card again to close the comparison. The selected competitor is kept in the page's address, so a refresh or a shared link opens the same one.

The comparison reads the same **Date Range** as the cards: its scores, **Gaps**, **Strengths**, **Prompt-by-Prompt** and the runs you open cover those days, and change with it. Its scores are the same AI Visibility Score as the cards, from 0 to 100 and not a percentage, for your brand and for the competitor alike over your answers: for the whole comparison, each platform, each prompt and each answer.

When there's nothing to compare yet, it says **No comparison data**: run tracking for your prompts first.

## Scores and Platform Breakdown

At the top of the comparison, **Your Visibility score** and **Their Visibility score** show each side's score out of 100 over the date range, the same numbers as the two cards, and **Difference** shows the gap between them in points.

**Platform Breakdown** shows your score and the competitor's on each AI platform, with the difference. A competitor can lead on one platform and trail on another, so aim your work at the platforms where it's ahead. It lists the platforms your plan tracks, with **No answers in this period** for one without answers yet. Microsoft Copilot is asked through Bing AI Mode. Platforms outside your plan, such as Claude on Growth, aren't shown; a line under the card names them.

## Gaps and Strengths

- **Gaps** lists up to 10 prompt and platform combinations where the competitor scores higher, grouped by prompt, the widest gap first.
- **Strengths** lists up to 10 where you score higher, your biggest lead first.

A prompt with several platforms opens to show each one.

Each gap has two next steps. **Create action** opens Chat beside the page with a request to send the gap to the Action Center; Chat writes its tasks, checks for an action that already covers it and asks before creating it. **Ask Chat** asks why the competitor is ahead there and what to change first. Both wait in Chat's box for you to send.

## Prompt-by-Prompt Comparison

**Prompt-by-Prompt Comparison** lists every prompt with **You**, **Them** and **Diff**, the most recently run first, and how many platforms and runs it has.

Click a prompt to see each platform once, with its scores, and its locations under it, each with its runs. A location answered by two models names the model. A score from fewer than 10 runs is marked **Low sample**: one answer can move it a lot. Click a location with more than one run to see its **Previous runs**, with the date, both scores, the difference and the sentiment. The eye icon opens an AI answer.

**Export CSV** beside the comparison's title downloads it per prompt and platform: the model, region, runs, both scores, the difference and the latest run.


## Find a prompt in the comparison

Above the list, **Search prompts** keeps the prompts with every word you type. Sort them **Most recent first** or **Widest gap first**, and pick a **Category** when your prompts have them. The list shows 20 prompts at a time; **Show more** adds the next ones. When two prompts differ only in letter case, a line says so: pause the extra copy on **Prompts** so their answers count once.
## The competitor's pages over time

Below the comparison, a card shows why the competitor may be rising. Its chart shows the answers that mentioned the competitor, and your brand, each week for the last twelve weeks. A marker sits on each week something happened to its pages; the events are listed newest first:

- **First cited in your tracked answers**: the first day an AI answer to one of your prompts cited one of its pages. When a competitor is added, Ansvisor reads back 90 days of your answers once, so the first date is the first within that window.
- **Changed**: once a week, Ansvisor reads again the 10 competitor pages your answers cited most over the last two weeks. When a page's words changed by more than a date or a price moving, it says so, with the Site Audit checks it gained or lost, such as an FAQ or a table.

## How the pages are read

The card needs the competitor's domain to find its pages. Pages are read for free from their public address, within a few reads a day, never from a site whose robots.txt keeps crawlers out. The brand's daily page reads are shared with the Action Center's tasks, which go first.

Only what Site Audit's checks found and a summary of the page's words are kept, never its text. Nothing is compared with another brand's answers.

## Close a visibility gap

1. On **Gaps**, find the prompts where the competitor leads most.
2. Open the AI answer with the eye icon: what is the competitor named or cited for? The pages-over-time card shows whether its pages changed, and **Competitor Gaps** on Visibility's **Citations** tab lists the sources AI cites with the competitor and not with you.
3. Create content for that prompt in **Content**.
4. Publish it, earn placements on those sources, and watch the prompt in the comparison as new answers are tracked.

## Which prompts a count is out of

Point at a card's prompt count, such as 12/40 prompts, to see which prompts it's out of: "40 prompts with answers in the last 30 days". It counts the prompts that got an AI answer in the date range, so it changes with the range. A report counts its own period, and Today counts the prompts you track now, active ones only, so their numbers can differ from this one.
