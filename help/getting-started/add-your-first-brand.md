---
title: Add your first brand
route: /dashboard/brands/new
keywords: [add brand, onboarding, setup wizard, first brand, brand setup, target market, free trial, plan already active, how do you want to start, sample brand, connect your site]
synonyms: [get started, create a brand, set up my account, onboard, add another brand, set up a brand after buying, start the free trial, explore the demo, add the tracking snippet during setup, send the snippet to my developer]
plan: all
updated: 2026-11-17
last_checked: 2026-11-17
owner: Cihan
app_version: 0.3.0
approved: true
sources: [docs/guides/add-your-first-brand.mdx]
---
When you start with Ansvisor, a setup wizard walks you through your first brand. It usually takes a few minutes, and you need the website of the brand you want to track. On the cloud, you first choose how to start: the free trial, a plan, or the sample brand. The setup itself has five steps, then on the cloud an optional last screen, **Connect your site**. From the second step on, your progress is saved as you go, so if you leave, you pick up where you stopped.

## On the cloud: choose how to start

The first screen, **How do you want to start?**, opens on the free trial. You can pick **Monthly**, **Yearly** or **Demo** instead.

- **Start 14-day free trial** opens checkout. You enter card details, nothing is charged until the trial ends, and you can cancel any time. The trial comes with an organization's first subscription only.
- **Buy now**, or a plan without a trial, starts the plan the same day.

After checkout, the five setup steps open, and your brand's first run starts when you finish them.

Not ready to add a card? Pick **Demo**, then **Explore the sample brand**, or select **Explore a sample brand first** under the plans. The sample brand is made up, with sample data: you can open every page, but nothing runs or changes. When you pick a plan there, you set up your own brand.

A self-hosted install has no such screen.

## Step 1: Brand basics

**Set up your brand** asks for three fields:

- **Brand name**: exactly how the brand is named in the wild, not an abbreviation. Mention detection ignores upper and lower case.
- **Website**: your main domain, such as example.com; the https part is already filled in. It's used to recognize citations of your site and to suggest competitors.
- **Describe your brand** (optional, but recommended): one to three sentences on your industry and your audience. It helps Ansvisor suggest better topics, prompts and competitors.

There's no separate industry field: put your industry in the description.

## Step 2: Region and language

On **Select your target market**, pick the region and language your audience uses. For the United States you can also pick a state, which localizes AI answers to it; leave it empty for nationwide results.

Your choice decides:

- the language your suggested topics and prompts are written in, and so the language AI engines answer in;
- the location your prompts are asked from;
- the competitors suggested in step 5.

You can track prompts in more locations later.

## Step 3: Topics

On **Choose topics to monitor**, Ansvisor uses your brand details and an AI model to suggest topics: themes your customers care about. The first seven come checked.

Check the topics that fit your brand and uncheck any that don't apply, up to 10. You can also type a topic name of your own and add it with **+**. If suggestions can't be fetched, add your own. **Looks good** moves on.

Aim for four to seven topics. Too few gives a narrow view; too many is noisy and hard to read.

## Step 4: Prompts

On **Choose your prompts**, Ansvisor writes five starter prompts for each topic you chose: real questions a potential customer would ask an AI engine. They come as a checklist, up to 15 ticked, within your plan's room:

- untick the ones that don't fit; only ticked prompts are saved;
- remove a whole topic from its **…** menu with **Remove topic**;
- add your own under each topic; they come ticked.

Tick more than your plan has room for, and the rest are saved as waiting for a spot: not tracked until you pause a prompt or raise your limit. Once tracking starts, the prompts are asked daily, on every AI platform your plan allows.

Keep prompts free of your brand name. A question about your brand by name almost always scores high, because the AI talks about you when asked, so it doesn't measure how AI engines find you on their own.

## Step 5: Competitors

On **Add your competitors**, Ansvisor suggests competitors for your brand. Check the real rivals, and uncheck or remove the ones that aren't comparable. Add your own with a company name and domain, using the name as it appears in AI answers rather than the website address.

Select at least one competitor to continue. **Start tracking with N competitors** finishes the brand and starts its first run. Competitor tracking is on every plan.

If your site looks like an online store, Ansvisor turns on Product Visibility for the brand and says so on this step. You can turn it off in the brand settings.

## Last, optional: Connect your site

On the cloud, once **Start tracking with N competitors** has started your brand's first run, **Connect your site** shows your brand's AI Traffic snippet: one line for your site's head. Without it, AI Traffic shows no AI visits, conversions or revenue.

1. Copy the snippet with the copy button.
2. Paste it just before the head closes on every page of your site, then publish.
3. Click **Check again** to see whether your home page has it.

Someone else edits your site? **Email this to my developer** opens your email app with the snippet and these steps; **Copy message** copies the same text.

**Done, go to my dashboard** and **I'll do it later** both open **Prompts › Tracked Prompts** while the first run goes on, with its progress above the table. If you skip it, the snippet stays first in **Finish setting up** on the Action Center's **Today** tab.

## Set up your brand with a plan active

Whenever your workspace has an active plan or free trial but no brand of its own, admins and managers go straight to the setup wizard when they open Ansvisor: after checkout on the first screen, after buying from the sample brand, or once the only brand was deleted. On the last step, **Start tracking with N competitors** finishes the brand, fits its prompts to your plan and starts its first run at once; **Connect your site** follows. If you leave part-way, you pick up where you stopped. Admins who want to change or cancel the plan first can use **Manage your plan** under the steps: it opens Billing, and setup waits for half an hour. If the trial is canceled, the plan ends or a payment fails before you finish, Ansvisor opens read-only instead, so you can choose a plan in Billing.

## A brand set up before choosing a plan

If your workspace set up its brand before choosing a plan, the plan step comes after the competitors. **Continue with N competitors** saves the brand and opens **Choose how to start**, with the same choices; tracking starts when you start the free trial or buy a plan. There, **Demo** keeps your brand saved until you pick a plan.

## Add another brand later

To add another brand, admins and managers pick **Add Brand** in the brand switcher. It walks through the same first five steps. Your plan sets how many brands you can have.
