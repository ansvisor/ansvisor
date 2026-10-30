// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChatStaff, staffEmails } from './staff';

/**
 * Ansvisor staff for Chat's Debug view (CHAT-03 items 25–26; W1-15): a
 * confirmed sign-in e-mail in STAFF_EMAILS, in any case; nobody without it.
 */

const CONFIRMED = '2026-10-01T09:00:00.000Z';

afterEach(() => vi.unstubAllEnvs());

describe('isChatStaff', () => {
  it('is nobody while STAFF_EMAILS is unset or empty', () => {
    vi.stubEnv('STAFF_EMAILS', '');
    expect(staffEmails()).toEqual([]);
    expect(isChatStaff({ email: 'ops@ansvisor.com', email_confirmed_at: CONFIRMED })).toBe(false);
  });

  it('reads the list trimmed, in any case, blanks dropped', () => {
    vi.stubEnv('STAFF_EMAILS', ' Ops@Ansvisor.com, ,support@ansvisor.com ');
    expect(staffEmails()).toEqual(['ops@ansvisor.com', 'support@ansvisor.com']);
    expect(isChatStaff({ email: 'OPS@ansvisor.com', email_confirmed_at: CONFIRMED })).toBe(true);
    expect(isChatStaff({ email: 'admin@customer.com', email_confirmed_at: CONFIRMED })).toBe(false);
  });

  it('needs a confirmed e-mail, and a person', () => {
    vi.stubEnv('STAFF_EMAILS', 'ops@ansvisor.com');
    expect(isChatStaff({ email: 'ops@ansvisor.com', email_confirmed_at: null })).toBe(false);
    expect(isChatStaff({ email: 'ops@ansvisor.com' })).toBe(false);
    expect(isChatStaff(null)).toBe(false);
  });
});
