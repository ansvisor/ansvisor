/**
 * A saved report with the same template over the same days (UX audit
 * RP-11): Generate asks "Same period as an existing report. Open it?"
 * before making a second copy. Days compare by date, the time left out.
 */

interface PeriodReport {
  template: string;
  dateFrom: string;
  dateTo: string;
}

const day = (iso: string) => iso.slice(0, 10);

/** The newest report of `want`'s template and days, or null. */
export function samePeriodReport<T extends PeriodReport & { createdAt?: string }>(
  reports: readonly T[],
  want: PeriodReport,
): T | null {
  const same = reports.filter(
    (report) =>
      report.template === want.template &&
      day(report.dateFrom) === day(want.dateFrom) &&
      day(report.dateTo) === day(want.dateTo),
  );
  return same.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0] ?? null;
}
