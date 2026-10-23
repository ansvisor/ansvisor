import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * While the Content Agent fixes the open rules (v1.1 CE-027/035), a dashed
 * card in the page where its change will most likely land — under the H1,
 * where a summary goes — saying it is drafting, and from which data. A
 * decoration, never the page's: no save, export or copy has it.
 */

interface Drafting {
  /** "Content Agent is drafting a change here…". */
  title: string;
  /** "Drafting from 4 cited pages and 2 fan-outs…", or null when it isn't drafting. */
  text: string | null;
}

interface DraftingState extends Drafting {
  marks: DecorationSet;
}

export const draftingKey = new PluginKey<DraftingState>('agentDrafting');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The card: what it does, from which data, and lines that shimmer (still without motion). */
function card({ title, text }: Drafting): HTMLElement {
  const box = el('div', 'not-prose my-3 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5');
  box.setAttribute('role', 'status');
  box.dataset.agentDrafting = '';
  box.append(
    el('p', 'text-[13px] font-medium text-foreground', title),
    el('p', 'text-xs text-muted-foreground', text ?? ''),
  );
  const lines = el('div', 'mt-2 space-y-1.5');
  lines.setAttribute('aria-hidden', 'true');
  for (const width of ['w-full', 'w-5/6', 'w-3/5']) {
    lines.append(
      el('div', `h-2 ${width} animate-pulse rounded bg-muted motion-reduce:animate-none`),
    );
  }
  box.append(lines);
  return box;
}

export const AgentDrafting = Extension.create({
  name: 'agentDrafting',

  addProseMirrorPlugins() {
    return [
      new Plugin<DraftingState>({
        key: draftingKey,
        state: {
          init: () => ({ title: '', text: null, marks: DecorationSet.empty }),
          apply: (tr, value, _old, state) => {
            const meta = tr.getMeta(draftingKey) as Drafting | undefined;
            if (!meta && !tr.docChanged) return value;
            const next = meta ?? { title: value.title, text: value.text };
            if (!next.text) return { ...next, marks: DecorationSet.empty };
            // After the first block (the H1), else at the top.
            const pos = state.doc.firstChild?.nodeSize ?? 0;
            return {
              ...next,
              marks: DecorationSet.create(state.doc, [
                Decoration.widget(pos, () => card(next), {
                  key: `drafting:${next.title}:${next.text}`,
                  side: 1,
                  ignoreSelection: true,
                  stopEvent: () => true,
                }),
              ]),
            };
          },
        },
        props: {
          decorations: (state) => draftingKey.getState(state)?.marks ?? null,
        },
      }),
    ];
  },
});
