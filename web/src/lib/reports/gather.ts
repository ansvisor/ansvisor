/**
 * Gathers one report section, trying once more when the first read fails
 * (UX audit RP-06). Most failures are a statement that ran out of the
 * database's time budget while every other section competed for the same
 * I/O, and a second try usually goes through.
 *
 * A section that fails both times returns null and is handed to `onGap`, so
 * the caller can record it server-side. The report itself never names it:
 * a report is something people share, and "could not be gathered" is not a
 * line a client should read.
 */
export async function gatherSection<T>(
  name: string,
  run: () => Promise<T>,
  log: (message: string, err: unknown) => void,
  onGap: () => void,
): Promise<T | null> {
  try {
    return await run();
  } catch (first) {
    log(`[reports] section "${name}" failed, trying once more:`, first);
  }
  try {
    return await run();
  } catch (second) {
    log(`[reports] section "${name}" failed again and is left out of the report:`, second);
    onGap();
    return null;
  }
}
