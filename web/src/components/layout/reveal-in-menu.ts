/**
 * The sidebar's current item, brought into its menu's view only when it is
 * out of it (UX audit GL-02). `scrollIntoView` scrolled the menu even for
 * an item already on screen, and could tuck the menu's first items
 * ("Chat") under its top. Only the menu's own scroll moves, never the page.
 */

/** The closest ancestor that scrolls up and down, or null. */
function scrollBoxOf(item: HTMLElement): HTMLElement | null {
  for (let el = item.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
}

/** Scrolls the item's menu so the item shows, centred, when it doesn't already. */
export function revealInMenu(item: HTMLElement | null | undefined): void {
  if (!item) return;
  const box = scrollBoxOf(item);
  if (!box) return;
  const view = box.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  if (at.top >= view.top && at.bottom <= view.bottom) return;
  box.scrollTop += at.top - view.top - (view.height - at.height) / 2;
}
