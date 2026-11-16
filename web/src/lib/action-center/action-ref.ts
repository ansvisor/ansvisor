/**
 * An action's code as the app shows it, "AC-03": its number in its brand
 * (`actions.brand_no`, 00534), or its old global number ("AC-1497",
 * `actions.action_no`) until its brand is numbered. And the app's
 * addresses for a code:
 *   * `/dashboard/action-center/actions/AC-1497`, the one-action path from
 *     before 00534, keeps its meaning: the old global number, looked up with
 *     the person's own access (actions/[id]). Links made before (Slack,
 *     e-mail, History, notes) still open their action.
 *   * `/dashboard/action-center/actions/code/AC-03`, for a code in text (a
 *     Chat answer), which can't tell an old number from a brand's: the one
 *     action with that code or old number, else the list searched for it
 *     (actions/code/[ref]). Never a guess between two.
 * Every other link the app builds points by id (`?action=`).
 */

const ACTIONS_PAGE = '/dashboard/action-center/actions';
const CODE_PATH = `${ACTIONS_PAGE}/code`;

/** A real action number: digits only, no leading zero, at most 12 of them. */
const NUMBER = /^[1-9]\d{0,11}$/;
/** A number as a code shows it: also "01"–"09", a brand's first nine (00534). */
const CODE_NUMBER = /^(?:0[1-9]|[1-9]\d{0,11})$/;

/**
 * "AC-1497" or "AC-03" in running text. Not part of a longer word, number or
 * path (XAC-12, AC-12a, AC-1.497, /AC-12), so a near miss is never linked to
 * another action. Turkish suffixes after an apostrophe ("AC-62'yi") still
 * leave the number whole.
 */
const ACTION_REF =
  /(?<![\p{L}\p{N}_/-])AC-(0[1-9]|[1-9]\d{0,11})(?![\p{L}\p{N}_]|[.,-][\p{L}\p{N}])/gu;

/**
 * "AC-" and a number as it is shown: "AC-1497", "AC-03". Every action code
 * the app shows, links to or uses as an example comes from here; an
 * action's own code is actionCode, which picks the number (00534).
 */
export function actionRef(no: number | string): string {
  return `AC-${no}`;
}

/** The one-action path for old global number `no`, or null unless `no` is a real number's digits. */
export function actionRefHref(no: string): string | null {
  return NUMBER.test(no) ? `${ACTIONS_PAGE}/${actionRef(no)}` : null;
}

/** The address for a code in text ("AC-03", "AC-59"), or null unless it is one. */
export function actionCodeHref(no: string): string | null {
  return CODE_NUMBER.test(no) ? `${CODE_PATH}/${actionRef(no)}` : null;
}

/** The number in a one-action path's "AC-1497", or null for anything else (an id). */
export function actionRefNo(segment: string): number | null {
  const match = /^AC-(\d+)$/.exec(segment);
  return match && NUMBER.test(match[1]) ? Number(match[1]) : null;
}

/** The number in a code's path ("AC-03", "AC-59"), or null for anything else. */
export function actionCodeRefNo(segment: string): number | null {
  const match = /^AC-(\d+)$/.exec(segment);
  return match && CODE_NUMBER.test(match[1]) ? Number(match[1]) : null;
}

/** What an action's code is built from: its brand's number once its brand is numbered (00534). */
export type Numbered = { actionNo: number; brandNo?: number | null };

/**
 * The number in an action's code: its number in its brand, two digits at
 * least ("03", "53", "120"), or its old global number ("648") while its
 * brand isn't numbered yet (brand_no null).
 */
export function actionCodeNo(action: Numbered): string {
  return action.brandNo ? String(action.brandNo).padStart(2, '0') : String(action.actionNo);
}

/**
 * An action's code as the app shows it and Chat writes it, "AC-03". The one
 * place it is built: the Actions list's rows, its search and its CSV, the
 * action's drawer and exports, History, Chat and the MCP tools all read it here.
 */
export function actionCode(action: Numbered): string {
  return actionRef(actionCodeNo(action));
}

/**
 * "AC-648", the code an action had before its brand was numbered, while it
 * reads differently from its code now; else null. The drawer shows it.
 */
export function previousActionCode(action: Numbered): string | null {
  return action.brandNo && action.brandNo !== action.actionNo ? actionRef(action.actionNo) : null;
}

/**
 * The action number a search names, as Chat writes it or as typed: "AC-03",
 * "AC-251", "ac-251", "AC 251", "#251" or "251". Null for any other text,
 * which the Actions list then matches against its titles.
 */
export function searchedActionNo(query: string): number | null {
  const match = /^(?:ac[-\s]?|#)?(\d+)$/i.exec(query.trim());
  return match && CODE_NUMBER.test(match[1]) ? Number(match[1]) : null;
}

/**
 * Whether a search names this action by its code ("AC-03", "ac-3", "3"), or
 * by the old global number an earlier message gave it ("AC-648").
 */
export function matchesActionCode(action: Numbered, query: string): boolean {
  const no = searchedActionNo(query);
  return no !== null && (no === action.brandNo || no === action.actionNo);
}

/** A text's pieces: plain text, and each "AC-03" or "AC-1497" with the address for its code. */
export function splitActionRefs(text: string): (string | { ref: string; href: string })[] {
  const parts: (string | { ref: string; href: string })[] = [];
  let at = 0;
  for (const match of text.matchAll(ACTION_REF)) {
    const href = actionCodeHref(match[1]);
    if (!href || match.index === undefined) continue;
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push({ ref: match[0], href });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/**
 * Whether an address of the app opens one action: its own path (by id, by
 * old number or by code) or the Actions page with its drawer (`?action=`).
 * The Action Center's pages themselves (Actions, Signals, KPIs, History) don't.
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
  return rest !== '' && (!rest.includes('/') || /^code\/AC-\d+$/.test(rest));
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
 * A remark plugin: each "AC-03" or "AC-1497" in an answer's text becomes a
 * link to its code's address (actionCodeHref). Built from the number's
 * digits only, so the text around it never reaches the address; inside code
 * or an existing link it stays text.
 */
export function remarkActionRefs() {
  return (tree: MdNode) => linkRefsIn(tree);
}
