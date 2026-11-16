/**
 * An action's code as people see it, "AC-03": its number in its brand
 * (brand_no, 00534), two digits at least, or its old global number
 * (action_no, "AC-648") while its brand isn't numbered yet. The web builds
 * the same (actionCode, web/src/lib/action-center/action-ref.ts).
 *
 * @param {{ action_no?: number|string|null, brand_no?: number|null,
 *   actionNo?: number|string|null, brandNo?: number|null }} action
 */
export function actionCode(action) {
  const brandNo = action.brand_no ?? action.brandNo;
  return brandNo
    ? `AC-${String(brandNo).padStart(2, '0')}`
    : `AC-${action.action_no ?? action.actionNo}`;
}

/**
 * `{ brandNo }` for a send's answer once the action's brand is numbered
 * (00534), so the page names the action by its code; nothing before.
 *
 * @param {{ brand_no?: number|null } | null | undefined} row
 */
export const brandNoOf = (row) => (row?.brand_no ? { brandNo: row.brand_no } : {});
