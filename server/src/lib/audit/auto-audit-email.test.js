import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const languages = [];
const emails = {
  all1: 'ana@acme.test',
  all2: 'bo@acme.test',
  tea: 'cy@acme.test',
  coffee: 'dee@acme.test',
};
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => ({
      select: () => ({
        in: async (_col, ids) => ({
          data: languages.filter((r) => ids.includes(r.id)),
          error: null,
        }),
      }),
    }),
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: emails[id] } } }) } },
  },
}));
const readers = vi.hoisted(() => ({ map: new Map() }));
vi.mock('../access.js', () => ({ brandReaders: async () => readers.map }));
// Each brand's "Audit finished" choices (Settings › Notifications): none by default.
const finished = vi.hoisted(() => ({ byBrand: {} }));
vi.mock('../notifications/choices.js', () => ({
  brandAudience: async (_org, brandId) => finished.byBrand[brandId] ?? new Map(),
}));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('../email.js', () => ({ sendEmail }));

const { renderAutoAuditEmail, sendAutoAuditEmail } = await import('./auto-audit-email.js');
const { forgetMessages } = await import('../i18n.js');

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

describe('sendAutoAuditEmail', () => {
  const run = {
    brands: [
      { id: 'coffee', name: 'Acme Coffee', pages: 3, completed: 3, criticalIssues: 1 },
      { id: 'tea', name: 'Acme Tea', pages: 2, completed: 2, criticalIssues: 0 },
    ],
    nextRunAt: '2026-11-01T00:00:00.000Z',
  };

  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(true);
    finished.byBrand = {};
  });

  it('sends one e-mail listing every brand when everyone sees them all, as before', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['all2', new Set(['coffee', 'tea'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(['ana@acme.test', 'bo@acme.test']);
    expect(sendEmail.mock.calls[0][0].html).toContain('Acme Coffee');
    expect(sendEmail.mock.calls[0][0].html).toContain('Acme Tea');
  });

  it('leaves out the brands a person gets "Audit finished" for, so they never get both', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['all2', new Set(['coffee', 'tea'])],
    ]);
    finished.byBrand = {
      coffee: new Map([
        ['all1', 'instant'],
        ['all2', 'off'],
      ]),
      tea: new Map([
        ['all1', 'daily'],
        ['all2', 'off'],
      ]),
    };
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    // all1 chose it for both brands: nothing here; all2 gets the run as before.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(['bo@acme.test']);
    finished.byBrand = { coffee: new Map([['all1', 'instant']]) };
    sendEmail.mockClear();
    await sendAutoAuditEmail('org-1', run);
    // all1 still gets the tea brand's.
    const mine = sendEmail.mock.calls.find(([mail]) => mail.to.includes('ana@acme.test'))[0];
    // Tea's 2 pages alone, not Coffee's 3.
    expect(mine.html).toContain('2 pages audited');
    expect(mine.html).not.toContain('Acme Coffee');
  });

  it('gives someone with Selected brands only the brands they see', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['tea', new Set(['tea'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const teaOnly = sendEmail.mock.calls.find(([mail]) => mail.to.includes('cy@acme.test'))[0];
    expect(teaOnly.to).toEqual(['cy@acme.test']);
    expect(teaOnly.html).toContain('2 pages audited');
    expect(teaOnly.html).not.toContain('Acme Coffee');
  });

  it('sends each group of the same brands its own e-mail, and skips someone with no e-mail', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['tea', new Set(['tea'])],
      ['coffee', new Set(['coffee'])],
      // Signed up by a provider that gave no e-mail: nobody to send to.
      ['ghost', new Set(['coffee', 'tea'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(3);
    const mails = sendEmail.mock.calls.map(([mail]) => mail);
    expect(mails.map((mail) => mail.to)).toEqual([
      ['ana@acme.test'],
      ['cy@acme.test'],
      ['dee@acme.test'],
    ]);
    const coffeeOnly = mails[2];
    expect(coffeeOnly.html).toContain('3 pages audited');
    expect(coffeeOnly.html).not.toContain('Acme Tea');
  });

  it('sends nothing to no one, and says when one e-mail wasn’t accepted', async () => {
    readers.map = new Map();
    expect(await sendAutoAuditEmail('org-1', run)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['tea', new Set(['tea'])],
    ]);
    sendEmail.mockResolvedValueOnce(false);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(false);
  });
});

describe('in each reader’s language (LOC-008)', () => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../messages/de.json',
  );
  const run = {
    brands: [{ id: 'coffee', name: 'Acme Coffee', pages: 3, completed: 3, criticalIssues: 1 }],
    nextRunAt: '2026-11-01T00:00:00.000Z',
  };
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(true);
    finished.byBrand = {};
    fs.writeFileSync(
      file,
      JSON.stringify({
        autoAudit: {
          title: 'Auto-Audit abgeschlossen',
          summary:
            '{pages, plural, one {# Seite} other {# Seiten}} geprüft · {issues, plural, one {# kritisches Problem} other {# kritische Probleme}}',
        },
      }),
    );
    forgetMessages();
  });
  afterEach(() => {
    languages.length = 0;
    fs.rmSync(file, { force: true });
    forgetMessages();
  });

  it('renders the German copy, plurals and all, and keeps English for what has no text', () => {
    const { subject, html } = renderAutoAuditEmail(run, 'de');
    expect(subject).toBe('Site Audit: 3 Seiten geprüft · 1 kritisches Problem');
    expect(html).toContain('Auto-Audit abgeschlossen');
    expect(html).toContain('Open Site Audit');
  });

  it('sends the same brands in one e-mail per language, to the same people', async () => {
    languages.push({ id: 'all2', ui_language: 'de' });
    readers.map = new Map([
      ['all1', new Set(['coffee'])],
      ['all2', new Set(['coffee'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    const mails = sendEmail.mock.calls.map(([mail]) => mail);
    expect(mails).toHaveLength(2);
    expect(mails.find((mail) => mail.to[0] === 'ana@acme.test').subject).toBe(
      'Site Audit: 3 pages audited · 1 critical issue',
    );
    expect(mails.find((mail) => mail.to[0] === 'bo@acme.test').subject).toBe(
      'Site Audit: 3 Seiten geprüft · 1 kritisches Problem',
    );
  });
});
