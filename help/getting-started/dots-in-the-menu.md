---
title: Dots in the menu
route: /dashboard
keywords: [menu dot, green dot, yellow dot, red dot, grey dot, new results, needs you, needs attention, working on it, action center count]
synonyms: [what does the dot mean, colored dot, notification dot, badge in the menu, unread]
plan: all
updated: 2026-11-11
last_checked: 2026-11-11
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/menu-access.mdx, docs/guides/action-center.mdx]
---
Small dots in the main menu show where something is new since you last opened a page, where something broke, and where Ansvisor is working right now.

## Green: New results

A green dot means new results since you last opened the page. After each nightly tracking run, it shows on **Overview**, **Mentions** and **Citations** under **Visibility**, and on **Tracked Prompts** under **Prompts**. **Visibility** also says **New results** beside its name. On **AI Referral Traffic**, a green dot means the snippet or Google Analytics is now connected. Each dot goes once you open its page.

## Yellow: Needs you

A yellow dot means something waits for you. It shows on **Actions** in the **Action Center** when new actions arrive, on **Opportunities** in **Content** when new opportunities arrive, on **Prompt Suggestions** when there are new suggestions, and on **Tracked Prompts** while prompts wait for a spot on your plan. On **AI Referral Traffic**, it stays until the snippet or Google Analytics is connected. Only admins and managers see yellow dots.

## Red: Needs attention

A red dot with a **!** means something broke and needs fixing. It shows on **AI Referral Traffic** when Search Console or Google Analytics is disconnected, on **Audit** when the latest audit found your site blocking AI crawlers, on **Library** in **Content** when a page didn't reach your CMS, and on **Agents** when the latest run of one of your agents failed. Opening the page doesn't clear it: it goes once the problem is fixed. **Today** lists it first under **Waiting for you**, with a link to fix it. Only admins and managers see red dots, and the demo brand shows none.

## Grey: Working on it

A grey dot that pulses means Ansvisor is working on it right now: an agent is running (**Agents**), the Content Agent is writing a page (**Editor**), today's tracking is running (**Visibility** and **Tracked Prompts**), or an audit is running (**Audit**). It goes soon after the work ends. Everyone sees grey dots. If you have asked your device for less motion, it holds still.

## When a menu is folded

When a submenu, a group such as **Analytics** or the whole menu is folded, the dot shows on the item's icon or the group's name. Red wins over yellow, yellow over green and green over grey. Point at a dot to read what it means, such as **Needs attention: Search Console disconnected**; screen readers say it too.

## In Chat and on agent cards

Chat's chats and the agent cards in **Action Center › Agents** use the same dots. A chat is grey while Chat works in it, yellow while it waits for you, green when it finished while you were away, and red when its last run stopped with an error. An agent's card is grey while it runs, yellow while it waits for your OK, and red when its last run failed.

## The Action Center's number

The number beside **Action Center** is how many open actions are unassigned or yours. It is hidden once your plan or trial has ended. The demo brand shows green and grey dots only, a workspace whose plan ended shows no yellow, and a section off your menu shows none.
