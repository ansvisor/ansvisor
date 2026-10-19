import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { renderAutoAuditEmail } = await import('./auto-audit-email.js');

describe('renderAutoAuditEmail', () => {
  it('sums up the run, with the next run date', () => {
    const { subject, html } = renderAutoAuditEmail({
      brands: [{ name: 'Acme Coffee', pages: 25, completed: 25, criticalIssues: 6 }],
      nextRunAt: '2026-10-28T09:00:00.000Z',
    });
    expect(subject).toBe('Site Audit: 25 pages audited · 6 critical issues');
    expect(html).toContain('25 pages audited · 6 critical issues · next run Oct 28');
    // Open Site Audit lands on Pages, where the run's audits are.
    expect(html).toContain('href="http://localhost:3000/dashboard/audit?tab=pages"');
    // One brand: no per-brand list, nothing failed.
    expect(html).not.toContain('<ul');
    expect(html).not.toContain("couldn't");
  });

  it('lists each brand, says what failed and escapes names', () => {
    const { subject, html } = renderAutoAuditEmail({
      brands: [
        { name: 'Acme <Coffee>', pages: 3, completed: 2, criticalIssues: 1 },
        { name: 'Acme Tea', pages: 1, completed: 1, criticalIssues: 0 },
      ],
      nextRunAt: '2026-11-01T00:00:00.000Z',
    });
    expect(subject).toBe('Site Audit: 3 pages audited · 1 critical issue');
    expect(html).toContain('Acme &lt;Coffee&gt;: 2 pages audited · 1 critical issue');
    expect(html).toContain('Acme Tea: 1 page audited · 0 critical issues');
    expect(html).toContain("1 page couldn't be audited");
  });
});
