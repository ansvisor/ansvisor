---
title: Create images in Chat
route: /dashboard/chat
keywords: [create image, make an image, generate image, cover image, image model, nano banana, gpt image, images in chat]
synonyms: [ai image, picture, illustration, hero image, blog cover, featured image, draw]
plan: all
updated: 2026-11-03
last_checked: 2026-11-03
owner: Cihan
app_version: 0.3.0
approved: false
sources: [web/messages/en.json, help/chat/files.md]
---
Chat can make images for your brand, such as a cover for a blog post. Ask in your own words, for example "Create a cover image for our GEO post", in any language. Admins and Managers can create images.

## Pick an image model

The first time you ask for an image in a chat, Chat asks **Which image model should I use?** The first option is marked **Recommended**: it is the one that uses your AI limit most slowly. Each option shows how fast it uses your AI limit compared with that one (**1x**, **2x**, **4x**) and about how much of your monthly AI limit one image uses. Chat uses your pick for every image in that chat, unless you ask for another model.

## Approve the images

Before any image is made, Chat shows a card with how many images it will make, the model, and about how much of your monthly AI limit they use. Click **Approve** to make them. The card shows in every mode, Full auto too.

Each request makes 4 images. When your remaining AI limit covers only some of them, Chat asks first, for example "Your remaining AI limit covers about 1 of the 4 images." Pick **Create 1 image now**, **Get more AI credits** or **Cancel**. No image is made before you answer.

## Pick and download an image

The images show on a card under the answer, the first one selected. Click another image to select it. Click **PNG** to download the selected image.

The set is saved to **Files** as one file, and it counts toward your storage. Its download there is the selected image. When Files is full, Chat says so before making any image.

## When no image comes

Sometimes the image model doesn't make an image for a prompt, for example when the prompt asks for something it won't draw. Chat tells you why in one line and offers a reworded prompt you can send.

## Your own AI key

When your workspace runs Chat on its own OpenRouter key, images are made on that key: the model question says **Your key**, and they don't use your monthly AI limit. With a key from another provider, images use your monthly AI limit.
