import { describe, expect, it } from 'vitest';
import { samePeriodReport } from './same-period';

const report = (
  id: string,
  template: string,
  dateFrom: string,
  dateTo: string,
  createdAt: string,
) => ({
  id,
  template,
  dateFrom,
  dateTo,
  createdAt,
});

describe('a report of the same period (UX audit RP-11)', () => {
  const reports = [
    report(
      'r1',
      'executive_summary',
      '2026-11-13T00:00:00Z',
      '2026-11-19T23:59:59Z',
      '2026-11-19T10:00:00Z',
    ),
    report(
      'r2',
      'executive_summary',
      '2026-11-13T00:00:00Z',
      '2026-11-19T23:59:59Z',
      '2026-11-20T09:00:00Z',
    ),
    report('r3', 'weekly', '2026-11-13T00:00:00Z', '2026-11-19T23:59:59Z', '2026-11-20T09:00:00Z'),
  ];

  it('finds the newest of the same template and days, the time left out', () => {
    expect(
      samePeriodReport(reports, {
        template: 'executive_summary',
        dateFrom: '2026-11-13T05:00:00Z',
        dateTo: '2026-11-19T10:00:00Z',
      })?.id,
    ).toBe('r2');
  });

  it('finds none for other days or another template', () => {
    expect(
      samePeriodReport(reports, {
        template: 'executive_summary',
        dateFrom: '2026-11-12T00:00:00Z',
        dateTo: '2026-11-19T00:00:00Z',
      }),
    ).toBeNull();
    expect(
      samePeriodReport(reports, {
        template: 'competitive',
        dateFrom: '2026-11-13T00:00:00Z',
        dateTo: '2026-11-19T00:00:00Z',
      }),
    ).toBeNull();
  });
});
