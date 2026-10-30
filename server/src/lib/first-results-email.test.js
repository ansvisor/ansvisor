import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Your first results are ready" (00385): e-mailed when a brand's first full
 * run stamps, once per person, to the organization's members never sent it.
 */

const db = vi.hoisted(() => ({
  brand: { data: { name: 'Acme Coffee', organization_id: 'org-1', is_demo: false }, error: null },
  // The organization's real brands, and its earliest stamped run.
  orgBrands: { data: [{ id: 'brand-1' }, { id: 'brand-2' }], error: null },
  firstRun: { data: [{ brand_id: 'brand-1' }], error: null },
  runQueries: [],
  claimed: { data: [{ id: 'u1' }, { id: 'u2' }], error: null },
  emails: { u1: 'ana@acme.test', u2: 'bo@acme.test' },
  updates: [],
}));
const deliverEmail = vi.hoisted(() => vi.fn());

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      if (table === 'brands') {
        // The brand itself (… eq id … single), or the organization's real
        // brands (… eq organization_id … eq is_demo false).
        return {
          select: () => ({
            eq: () => ({
              single: async () => db.brand,
              eq: async (column, value) =>
                column === 'is_demo' && value === false
                  ? db.orgBrands
                  : { data: null, error: { message: 'unexpected filter' } },
            }),
          }),
        };
      }
      if (table === 'tracking_runs') {
        const query = [];
        db.runQueries.push(query);
        const chain = {
          select: (columns) => (query.push(['select', columns]), chain),
          in: (column, value) => (query.push(['in', column, value]), chain),
          not: (column, op, value) => (query.push(['not', column, op, value]), chain),
          order: (column, options) => (query.push(['order', column, options]), chain),
          limit: async (n) => (query.push(['limit', n]), db.firstRun),
        };
        return chain;
      }
      // profiles: the claim (update … is null … select) or its release (update … in).
      return {
        update: (values) => {
          const update = { values, filters: [] };
          db.updates.push(update);
          const chain = {
            eq: (column, value) => (update.filters.push(['eq', column, value]), chain),
            is: (column, value) => (update.filters.push(['is', column, value]), chain),
            in: async (column, value) => (
              update.filters.push(['in', column, value]),
              { error: null }
            ),
            select: async () => db.claimed,
          };
          return chain;
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (id) => ({ data: { user: { email: db.emails[id] } } }),
      },
    },
  },
}));
vi.mock('./email.js', () => ({ deliverEmail }));
vi.mock('./logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { renderFirstResultsEmail, sendFirstResultsEmail } = await import('./first-results-email.js');

beforeEach(() => {
  db.brand = {
    data: { name: 'Acme Coffee', organization_id: 'org-1', is_demo: false },
    error: null,
  };
  db.orgBrands = { data: [{ id: 'brand-1' }, { id: 'brand-2' }], error: null };
  db.firstRun = { data: [{ brand_id: 'brand-1' }], error: null };
  db.runQueries = [];
  db.claimed = { data: [{ id: 'u1' }, { id: 'u2' }], error: null };
  db.updates = [];
  deliverEmail.mockReset().mockResolvedValue('sent');
});

describe('renderFirstResultsEmail', () => {
  it('says the results are in, with the way to Brand Visibility', () => {
    const { subject, html } = renderFirstResultsEmail({ brandName: 'Acme Coffee' });
    expect(subject).toBe('Your first results are ready: Acme Coffee');
    expect(html).toContain('Your first results are ready');
    expect(html).toContain("Acme Coffee's prompts for the first time");
    expect(html).toContain('href="http://localhost:3000/dashboard/insights"');
  });

  it('escapes the brand name', () => {
    const { html } = renderFirstResultsEmail({ brandName: 'Acme <Tea>' });
    expect(html).toContain('Acme &lt;Tea&gt;');
    expect(html).not.toContain('<Tea>');
  });
});

describe('sendFirstResultsEmail', () => {
  it('takes the members never sent it in one update, and e-mails them', async () => {
    expect(await sendFirstResultsEmail('brand-1')).toBe('sent');
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].values.first_results_emailed_at).toEqual(expect.any(String));
    expect(db.updates[0].filters).toEqual([
      ['eq', 'organization_id', 'org-1'],
      ['is', 'first_results_emailed_at', null],
    ]);
    expect(deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['ana@acme.test', 'bo@acme.test'],
        subject: 'Your first results are ready: Acme Coffee',
      }),
    );
  });

  it('sends nothing when everyone was sent it before', async () => {
    db.claimed = { data: [], error: null };
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('gives the claim back when nothing went out', async () => {
    deliverEmail.mockResolvedValue('refused');
    expect(await sendFirstResultsEmail('brand-1')).toBe('refused');
    expect(db.updates[1]).toEqual({
      values: { first_results_emailed_at: null },
      filters: [['in', 'id', ['u1', 'u2']]],
    });

    db.updates = [];
    deliverEmail.mockResolvedValue('skipped');
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    expect(db.updates[1].values).toEqual({ first_results_emailed_at: null });
  });

  it('keeps the claim when Resend may have sent it', async () => {
    deliverEmail.mockResolvedValue('unknown');
    expect(await sendFirstResultsEmail('brand-1')).toBe('unknown');
    expect(db.updates).toHaveLength(1);
  });

  it("reads the organization's earliest stamped run, of its real brands", async () => {
    await sendFirstResultsEmail('brand-1');
    expect(db.runQueries).toEqual([
      [
        ['select', 'brand_id'],
        ['in', 'brand_id', ['brand-1', 'brand-2']],
        ['not', 'completed_at', 'is', null],
        ['order', 'completed_at', { ascending: true }],
        ['limit', 1],
      ],
    ]);
  });

  it('sends nothing when the organization had results before, from another brand', async () => {
    // An existing workspace adding a brand, or the later of two first runs.
    db.firstRun = { data: [{ brand_id: 'brand-2' }], error: null };
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    expect(db.updates).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('sends nothing for a demo brand', async () => {
    db.brand = { data: { name: 'Demo', organization_id: 'org-1', is_demo: true }, error: null };
    expect(await sendFirstResultsEmail('brand-1')).toBe('skipped');
    expect(db.updates).toHaveLength(0);
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it('fails when the earliest run cannot be read, before taking anyone', async () => {
    db.firstRun = { data: null, error: { message: 'runs boom' } };
    await expect(sendFirstResultsEmail('brand-1')).rejects.toThrow('runs boom');
    expect(db.updates).toHaveLength(0);
  });

  it('fails when the brand cannot be read, before taking anyone', async () => {
    db.brand = { data: null, error: { message: 'boom' } };
    await expect(sendFirstResultsEmail('brand-1')).rejects.toThrow('boom');
    expect(db.updates).toHaveLength(0);
  });
});
