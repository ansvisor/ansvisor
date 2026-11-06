/** Typing in the search box reads once it pauses, not on every key. */
export const READ_DELAY_MS = 250;

/**
 * Starts a tab's read: at once the first time (the tab opening has nothing
 * to wait for, and a read sent at once goes ahead of the page's smaller
 * ones, as server actions run one at a time), then READ_DELAY_MS after the
 * last change. `first` is the tab's own flag; returns the cleanup.
 */
export function scheduleRead(first: { current: boolean }, read: () => void): () => void {
  if (first.current) {
    first.current = false;
    read();
    return () => {};
  }
  const timer = setTimeout(read, READ_DELAY_MS);
  return () => clearTimeout(timer);
}
