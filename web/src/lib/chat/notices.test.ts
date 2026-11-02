import { describe, expect, it } from 'vitest';
import { noticeOf, type NoticeRow } from './notices';

/**
 * A person's notices as the Inbox shows them (00441): the own key fails, or
 * its agents reached 80% or all of their monthly limit on it (PR 10). A row
 * the Inbox can't show is left out.
 */

const row = (over: Partial<NoticeRow>): NoticeRow => ({
  id: 'n1',
  kind: 'own_key_failed',
  payload: { provider: 'openai', class: 'no_credit', reminder: false },
  created_at: '2026-11-01T09:00:00Z',
  read_at: null,
  ...over,
});

describe('noticeOf', () => {
  it('reads a failing key’s notice', () => {
    expect(noticeOf(row({ read_at: '2026-11-01T10:00:00Z' }))).toEqual({
      id: 'n1',
      kind: 'own_key_failed',
      provider: 'openai',
      class: 'no_credit',
      reminder: false,
      createdAt: '2026-11-01T09:00:00Z',
      read: true,
    });
  });

  it('reads the key limit’s 80% and 100% notices', () => {
    const payload = {
      level: 80,
      usedUsd: 205,
      capUsd: 250,
      since: '2026-10-20T09:00:00.000Z',
      renewsAt: '2026-11-20T09:00:00.000Z',
    };
    expect(noticeOf(row({ kind: 'own_key_limit_80', payload }))).toEqual({
      id: 'n1',
      kind: 'own_key_limit',
      level: 80,
      usedUsd: 205,
      capUsd: 250,
      renewsAt: '2026-11-20T09:00:00.000Z',
      createdAt: '2026-11-01T09:00:00Z',
      read: false,
    });
    expect(
      noticeOf(row({ kind: 'own_key_limit_100', payload: { ...payload, renewsAt: null } })),
    ).toMatchObject({ kind: 'own_key_limit', level: 100, renewsAt: null });
  });

  it('leaves out a row it can’t show', () => {
    expect(noticeOf(row({ payload: { provider: 'copilot', class: 'no_credit' } }))).toBeNull();
    expect(noticeOf(row({ payload: null }))).toBeNull();
    expect(noticeOf(row({ kind: 'own_key_limit_80', payload: { capUsd: 250 } }))).toBeNull();
    expect(noticeOf(row({ kind: 'something_new' }))).toBeNull();
  });
});
