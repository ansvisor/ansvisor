/**
 * An action's number as the app shows it, "AC-1497" (`actions.action_no`),
 * and the app's own address that opens it: the Actions page's one-action
 * path, `/dashboard/action-center/actions/AC-1497`, which looks the number up
 * with the person's own access and opens its drawer (actions/[id]).
 */

const ACTIONS_PAGE = '/dashboard/action-center/actions';

/** A real action number: digits only, no leading zero, at most 12 of them. */
const NUMBER = /^[1-9]\d{0,11}$/;

/**
 * "AC-1497" in running text. Not part of a longer word, number or path
 * (XAC-12, AC-12a, AC-1.497, /AC-12), so a near miss is never linked to
 * another action. Turkish suffixes after an apostrophe ("AC-62'yi") still
 * leave the number whole.
 */
const ACTION_REF = /(?<![\p{L}\p{N}_/-])AC-([1-9]\d{0,11})(?![\p{L}\p{N}_]|[.,-][\p{L}\p{N}])/gu;

/** The address that opens action number `no`, or null unless `no` is a real number's digits. */
export function actionRefHref(no: string): string | null {
  return NUMBER.test(no) ? `${ACTIONS_PAGE}/AC-${no}` : null;
}

/** The number in a one-action path's "AC-1497", or null for anything else (an id). */
export function actionRefNo(segment: string): number | null {
  const match = /^AC-(\d+)$/.exec(segment);
  return match && NUMBER.test(match[1]) ? Number(match[1]) : null;
}

/** A text's pieces: plain text, and each "AC-1497" with the address that opens it. */
export function splitActionRefs(text: string): (string | { ref: string; href: string })[] {
  const parts: (string | { ref: string; href: string })[] = [];
  let at = 0;
  for (const match of text.matchAll(ACTION_REF)) {
    const href = actionRefHref(match[1]);
    if (!href || match.index === undefined) continue;
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push({ ref: match[0], href });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/**
 * Whether an address of the app opens one action: its own path (by id or by
 * number) or the Actions page with its drawer (`?action=`). The Action
 * Center's pages themselves (Actions, Signals, KPIs, History) don't.
 */
export function opensOneAction(href: string): boolean {
  if (!href.startsWith(ACTIONS_PAGE)) return false;
  let url: URL;
  try {
    url = new URL(href, 'https://app.invalid');
  } catch {
    return false;
  }
  if (url.origin !== 'https://app.invalid') return false;
  const path = url.pathname.replace(/\/$/, '');
  if (path === ACTIONS_PAGE) return Boolean(url.searchParams.get('action'));
  const rest = path.startsWith(`${ACTIONS_PAGE}/`) ? path.slice(ACTIONS_PAGE.length + 1) : '';
  return rest !== '' && !rest.includes('/');
}

/** A Markdown (mdast) node, as far as linking needs it. */
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/** Never linked inside: code, links and raw HTML keep their text as it is. */
const KEEP = new Set([
  'code',
  'inlineCode',
  'html',
  'link',
  'linkReference',
  'definition',
  'image',
  'imageReference',
]);

function linkRefsIn(node: MdNode): void {
  if (!node.children) return;
  let changed = false;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      const parts = splitActionRefs(child.value);
      if (parts.some((part) => typeof part !== 'string')) {
        changed = true;
        for (const part of parts) {
          next.push(
            typeof part === 'string'
              ? { type: 'text', value: part }
              : { type: 'link', url: part.href, children: [{ type: 'text', value: part.ref }] },
          );
        }
        continue;
      }
    } else if (!KEEP.has(child.type)) {
      linkRefsIn(child);
    }
    next.push(child);
  }
  if (changed) node.children = next;
}

/**
 * A remark plugin: each "AC-1497" in an answer's text becomes a link to that
 * action. Built from the number's digits only, so the text around it never
 * reaches the address; inside code or an existing link it stays text.
 */
export function remarkActionRefs() {
  return (tree: MdNode) => linkRefsIn(tree);
}
