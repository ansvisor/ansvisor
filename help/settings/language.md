---
title: Change the language of Ansvisor
route: /dashboard/settings/account
keywords: [language, interface language, change language, translate, my language, display language]
synonyms: [switch language, app language, screen language, use Ansvisor in another language]
plan: all
updated: 2026-11-19
last_checked: 2026-11-19
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, web/src/components/settings/language-field.tsx, web/src/components/settings/suggest-translation.tsx, web/src/components/auth/sign-up-form.tsx, server/messages/en.json]
---
Each person picks the language of their own Ansvisor screens. Find it in **Settings › Account › Language**, or in the **Language** item of the account menu at the bottom left, so you can change it from any page. It never changes anyone else's screens.

## Pick a language

Open **Language** and choose one. Each language is written in its own name, such as **Deutsch** or **Türkçe**, so you can find yours even when you can't read the current one. Your choice is saved as soon as you pick it, and the page reloads in that language. **Automatic** follows your browser's language, and uses English when Ansvisor doesn't have it yet.

The languages are English, Türkçe, Deutsch, Français, Español, Italiano, Português, Nederlands, 日本語, Polski, 简体中文, 한국어 and العربية. In Arabic, the screens read right to left.

You can also pick a language while you sign up, in the **Language** field of the sign-up form, once more than one is ready. The sign-up page switches to it, and it is saved as your language the first time you sign in, unless you have already chosen one.

## Dates and numbers

Dates and numbers follow your language, for example 1,234.5 in English and 1.234,5 in German. In a language read right to left, such as Arabic, the page is laid out right to left too, and side panels open from the left, the edge the page reads towards.

## Text that isn't translated yet

Anything without a translation shows in English, never as a blank or a code.

## E-mails and error messages

E-mails Ansvisor sends you come in your language too: first results, Site Audit, the Daily Pulse, the AI Traffic weekly digest, your workspace's AI key warnings, agent notices and scheduled job e-mails. So do the messages when something can't be done, such as a plan limit or a read-only workspace, on Prompts, Brands, Content and its editor, Competitors, Brand Visibility, Site Audit, AI Traffic, Reports, the Action Center, Chat, setup and the Settings pages for Team, Billing, AI Providers and Integrations. A job's title and an agent's answer stay as they were written. When you send a report to someone outside your workspace, its few fixed lines are in your language. A text that isn't translated yet comes in English. Who gets an e-mail, and when, doesn't change.

## Your brand's content language

This setting is only for the screens you read. The language your brand's prompts are tracked in and its content is written in is a brand setting, and picking a language here doesn't change it.

## Suggest a better translation

In any language but English, a translation can read wrong. Open **Settings › Account › Language** or the **Language** item of the account menu, and choose **Suggest a better translation**. The form already knows your language and the screen you are on. Type or paste the text as it reads now, or choose **Pick on screen** and click it. Then write your better version, and add a note if you like, such as why it is better. Press **Send suggestion**.

Our team reviews every suggestion. If we use it, the text is updated in a later release. Suggestions are kept with your account and used only to improve translations.
