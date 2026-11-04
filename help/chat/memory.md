---
title: Memory in Chat
route: /dashboard/chat/memory
keywords: [memory, remember, forget, used memory, saved notes, call me, remember that, forget that, use memory, memory page]
synonyms: [preferences, saved preferences, house style, what chat remembers, notes]
plan: all
updated: 2026-11-02
last_checked: 2026-11-02
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json]
---
Chat can remember short notes between chats, so you don't repeat the same preferences every time, such as "write blog posts in US English" or "reports as PDF". Memory keeps one line per note. Nothing is remembered without your click.

## Ask Chat to remember

Start a message with "Remember that…", in any language, for example: "Remember that our blog uses US English." Chat writes the fact as one short line on a card. You can change the words, with a counter under them, and pick where it goes under **Save to**: **Me**, the chat's brand, or **Workspace**. A place your role can't change is shown but can't be picked. When the note repeats or contradicts one you have, the card says **Replaces:** with the old note; untick it to keep both.

Nothing is saved until you click **Save**, in every mode, Full auto too. After that, the step reads **Saved to memory** with where it went.

Say "Forget that…" to remove a note. Chat finds the note and removes it once you approve, or by itself in Full auto. The step reads **Removed from memory**.

## Where a note goes

**Me** notes are yours alone: your name and how you like to work. Every role keeps its own. **Brand** notes are facts and rules for one brand, such as its product names or words to avoid. Admins and Managers change them. **Workspace** notes are rules for every brand and member. Admins change them; when a Manager saves one, the step reads **Sent to your Admins**, and the note is added once one of them approves the request.

Your first name from your profile becomes a **Call me** note, so Chat greets you by it.

## How Chat uses memory

Each chat uses your **Me** notes, the notes of the chat's brand and the **Workspace** notes. When notes disagree, your message wins, then **Me**, then the brand's, then the workspace's. When memory was used, the steps above the answer show **Used memory**, and **Data used** shows **Memory** with how many notes.

A note shapes how Chat does what you ask, such as the tone or the format. It never starts a change by itself and can't change Chat's rules, your role or what needs your approval. A change that only a note names still waits for your click, Full auto too.

## The Memory page

Open it from the **⋯** menu at the top of a chat, under **Memory**. The tabs **Me**, **Brand: {your brand}** and **Workspace** show how many notes each holds; the Brand tab follows the brand picked in the brand switcher. Each note shows its **Source** (**Profile**, **Saved from chat** or **Memory page**) and when it was last changed.

Click the pencil to change a note's words, then **Save**. Click the bin to delete it at once; **Undo** brings it back for 10 seconds. Where your role only reads a tab, both stay off.

The Brand tab also lists the brand's own rules from **Settings › Content**, read-only: change them there. They don't count toward the tab's limit.

## Turn memory off

**Use memory**, at the top right of the Memory page, is your own switch: off, Chat doesn't use your notes or save new ones. Even when your workspace is read-only, you can still turn it off and delete your own **Me** notes. An Admin can turn memory off for the whole workspace under **Settings › Chat**; then no one's notes are used, and only Admins see the Memory page's notes.

## What memory doesn't keep

Memory doesn't keep secrets or personal details: passwords, keys, card, bank or ID numbers, email addresses, phone numbers, home addresses or private facts about you or others. It also refuses text that tries to change Chat's rules. Chat tells you when it can't save a note.

A note is at most 300 characters, and **Me**, each brand and the workspace each hold up to 4,000 characters. When one is full, delete or shorten a note first. The limits are the same on every plan.
