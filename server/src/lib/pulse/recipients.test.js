import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daily Pulse's and the AI Traffic digest's recipients (brand access, spec
 * §5.4): an Admin's typed list as typed, else the members who can see the
 * brand — every member while everyone has All brands.
 */

const emails = { u1: 'ana@acme.test', u2: 'bo@acme.test' };
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => ({}),
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: emails[id] } } }) } },
  },
}));
const asked = vi.hoisted(() => ({ calls: [], readers: new Map() }));
vi.mock('../access.js', () => ({
  brandReaders: async (...args) => (asked.calls.push(args), asked.readers),
}));

const { resolveRecipients } = await import('./engine.js');

beforeEach(() => {
  asked.calls = [];
  asked.readers = new Map([
    ['u1', new Set(['b1'])],
    ['u2', new Set(['b1'])],
  ]);
});

describe('resolveRecipients', () => {
  it('sends to the members who can see the brand', async () => {
    expect(await resolveRecipients('org-1', {}, 'b1')).toEqual(['ana@acme.test', 'bo@acme.test']);
    expect(asked.calls).toEqual([['org-1', ['b1']]]);
    // Someone who can't see it isn't among them.
    asked.readers = new Map([['u2', new Set(['b1'])]]);
    expect(await resolveRecipients('org-1', null, 'b1')).toEqual(['bo@acme.test']);
  });

  it('keeps the list an Admin typed, as typed', async () => {
    expect(await resolveRecipients('org-1', { recipients: ['team@acme.test'] }, 'b1')).toEqual([
      'team@acme.test',
    ]);
    expect(asked.calls).toEqual([]);
  });
});
