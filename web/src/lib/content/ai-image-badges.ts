import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const badgesKey = new PluginKey<DecorationSet>('aiImageBadges');

/**
 * "AI-generated" under each AI image of the page, in the editor only: a
 * decoration, never the page's, so no save, export or copy has it.
 */
export const AiImageBadges = Extension.create<{ label: string }>({
  name: 'aiImageBadges',
  addOptions() {
    return { label: 'AI-generated' };
  },
  addProseMirrorPlugins() {
    const label = this.options.label;
    return [
      new Plugin({
        key: badgesKey,
        props: {
          decorations(state) {
            const badges: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'image' || !node.attrs.aiGenerated) return;
              badges.push(
                Decoration.widget(
                  pos + node.nodeSize,
                  () => {
                    const badge = document.createElement('span');
                    badge.dataset.slot = 'ai-image-badge';
                    badge.contentEditable = 'false';
                    badge.className =
                      'mt-1 inline-flex w-fit items-center rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground';
                    badge.textContent = label;
                    return badge;
                  },
                  { side: -1, key: `ai-image:${pos}`, ignoreSelection: true },
                ),
              );
            });
            return badges.length ? DecorationSet.create(state.doc, badges) : null;
          },
        },
      }),
    ];
  },
});
