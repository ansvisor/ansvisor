/**
 * What an answer is, from its Markdown alone (UX audit CH-10, CH-11).
 */

/** Fewer words than this and an answer isn't a page (CH-11). */
const PAGE_WORDS = 250;

/**
 * Whether an answer reads as a page to edit: a title (`# …`), or at least
 * two sections (`## …`) over PAGE_WORDS words. Open in Content Editor shows
 * on those only, not on a plain question's answer (CH-11).
 */
export function isContentAnswer(markdown: string): boolean {
  const text = markdown.replace(/```[\s\S]*?```/g, '');
  if (/^#\s+\S/m.test(text)) return true;
  const sections = text.match(/^##\s+\S/gm)?.length ?? 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  return sections >= 2 && words >= PAGE_WORDS;
}

/** A Markdown (mdast) node, as far as this needs it. */
type MdNode = { type: string; value?: string; children?: MdNode[] };

/** An action code alone in code marks, as models write it: `AC-12`. */
const CODE_ALONE = /^AC-\d{1,12}$/;

function codesAsText(node: MdNode): void {
  for (const child of node.children ?? []) {
    if (child.type === 'inlineCode' && child.value && CODE_ALONE.test(child.value.trim())) {
      child.type = 'text';
      child.value = child.value.trim();
    } else if (child.type !== 'code' && child.type !== 'link') {
      codesAsText(child);
    }
  }
}

/**
 * A remark plugin, before remarkActionRefs: an action code written in code
 * marks (`AC-12`) becomes plain text, so it links to its action as any
 * other code in the answer does (CH-10). Other code stays code.
 */
export function remarkCodeActionRefs() {
  return (tree: MdNode) => codesAsText(tree);
}
