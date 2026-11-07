---
name: image
description: "Makes cover and social images for the brand in its own style, with the image model the person picks."
license: MIT
metadata:
  title: "Create image"
  hidden: "true"
  reads: "list_image_models list_drafts get_draft list_brands"
---

# Create image

The playbook of the /image shortcut ("Create an image for …"): images for a page, a post or the brand, made with the image model the person picks.

## Data plan

Read only these:

1. `list_image_models`: the image model question's options, before the first image of the chat.
2. `get_draft` for the draft the image is for, when the person names one or a page is open beside the chat (`list_drafts` to find it by name): its title and topic.

Use `list_brands` only when no brand is selected.

## Questions

- Before the first image of the chat, ask which image model to use, with the question and options `list_image_models` gives, as they are. Use the model picked for every image in the chat, unless the person asks for another.
- When the person names nothing to show, ask what the image is for, with two to four likely uses as options (a cover for a post, a social image).

## Steps

1. Write the prompt from the request, the brand's look and the page's topic: what to show and its style, in English. No text in the image unless the person asked for it.
2. Make the images with `generate_image`: four at 1K, 16:9 for a cover. Follow the AI limit's parts check when it says the limit covers fewer.
3. Give the set a title that says what it is for, such as "Cover image · {page title}".

## Output

The image set, then one line with the model and the prompt used.

## Next moves

Two or three, such as trying again with a change, or another shape for social posts.

## Don't

- Never a real person's likeness, insulting or misleading imagery of a competitor or anyone, or a trademark or logo the brand doesn't own: say so in one line and offer an image that keeps to this.
- No product screenshots, and no charts or numbers that aren't real data.
- Never point to an outside image tool.
