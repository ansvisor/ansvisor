import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * The page's byline in a grey "Page info" strip under the H1 (Quality spec
 * §9, CE-038): the author is page metadata, which the CMS shows, never the
 * page's text. A decoration, never the page's: no save, export, Copy, Copy
 * HTML or HTML view has it.
 */

export interface PageInfo {
  /** "Page info · shown by your CMS, not part of the content". */
  label: string;
  /** "By Ada Lovelace · Head of Content · Updated Oct 23, 2026". */
  byline: string;
}

export const pageInfoKey = new PluginKey<PageInfo | null>('pageInfo');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function strip({ label, byline }: PageInfo): HTMLElement {
  const box = document.createElement('div');
  box.className =
    'not-prose my-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2 select-none';
  box.contentEditable = 'false';
  // The header's author menu says the same; a screen reader reading the page
  // shouldn't take it for the page's text.
  box.setAttribute('aria-hidden', 'true');
  box.dataset.pageInfo = '';
  // Divs, not paragraphs: nothing that looks for the page's paragraphs finds it.
  box.append(
    el('div', 'text-[11px] font-medium text-muted-foreground', label),
    el('div', 'mt-0.5 text-[13px] text-foreground [overflow-wrap:anywhere]', byline),
  );
  return box;
}

/** Where the strip goes: under the H1 that opens the page, else at the top. */
export function pageInfoAt(doc: PmNode): number {
  const first = doc.firstChild;
  return first?.type.name === 'heading' && first.attrs.level === 1 ? first.nodeSize : 0;
}

export const PageInfoStrip = Extension.create({
  name: 'pageInfo',

  addProseMirrorPlugins() {
    return [
      new Plugin<PageInfo | null>({
        key: pageInfoKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(pageInfoKey) as PageInfo | null | undefined;
            return meta === undefined ? value : meta;
          },
        },
        props: {
          decorations: (state) => {
            const info = pageInfoKey.getState(state);
            if (!info) return null;
            return DecorationSet.create(state.doc, [
              // Right under the H1: before a suggestion's card for the next
              // block (side -1) and the agent's drafting card (side 1).
              Decoration.widget(pageInfoAt(state.doc), () => strip(info), {
                key: `page-info:${info.label}:${info.byline}`,
                side: -2,
                ignoreSelection: true,
                stopEvent: () => true,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
