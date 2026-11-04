import Image from '@tiptap/extension-image';

/**
 * The page's image (CHAT-25 §9, W4-09): Tiptap's, with whether AI made it.
 * An AI image keeps `data-ai-generated="true"` on its img, so the page says
 * so wherever it goes (the editor, exports, the CMS), and Quality never
 * counts it as the page's own visual proof (page-read.ts pageImages).
 */
export const ContentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      aiGenerated: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-ai-generated') === 'true',
        renderHTML: (attributes: { aiGenerated?: boolean }) =>
          attributes.aiGenerated ? { 'data-ai-generated': 'true' } : {},
      },
    };
  },
});

/** The attribute an AI image's img keeps. */
export const AI_IMAGE_ATTRIBUTE = 'data-ai-generated';
