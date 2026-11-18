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
    // An agent waiting for its person (00474): the row records its e-mail; its chat is in Needs you.
    expect(
      noticeOf(
        row({ kind: 'agent_needs_you', payload: { agent: 'Brief', runId: 'r', chatId: 'c' } }),
      ),
    ).toBeNull();
  });

  it('reads an agent’s go-live notices (AUTONOMOUS-GO-LIVE §6.4, §7.2, 00446)', () => {
    const payload = {
      agent: 'Publisher',
      agentId: 'agent-1',
      title: 'Pricing FAQ',
      target: 'webflow',
      kind: 'cms_draft',
      draftId: 'draft-1',
      chatId: 'chat-1',
    };
    expect(noticeOf(row({ kind: 'agent_went_live', payload }))).toEqual({
      id: 'n1',
      kind: 'agent_went_live',
      agent: 'Publisher',
      title: 'Pricing FAQ',
      target: 'webflow',
      draftId: 'draft-1',
      chatId: 'chat-1',
      url: null,
      createdAt: '2026-11-01T09:00:00Z',
      read: false,
    });
    // Published live (PR 9): its address, an http(s) one only.
    expect(
      noticeOf(
        row({
          kind: 'agent_went_live',
          payload: { ...payload, kind: 'publish', url: 'https://acme.example/faq' },
        }),
      ),
    ).toMatchObject({ url: 'https://acme.example/faq' });
    expect(
      noticeOf(
        row({
          kind: 'agent_went_live',
          payload: { ...payload, kind: 'publish', url: 'javascript:x' },
        }),
      ),
    ).toMatchObject({ url: null });
    expect(
      noticeOf(row({ kind: 'agent_went_live', payload: { ...payload, chatId: null } })),
    ).toMatchObject({ chatId: null });
    expect(
      noticeOf(
        row({ kind: 'agent_go_live_off', payload: { agent: 'Publisher', agentId: 'agent-1' } }),
      ),
    ).toEqual({
      id: 'n1',
      kind: 'agent_go_live_off',
      agent: 'Publisher',
      agentId: 'agent-1',
      createdAt: '2026-11-01T09:00:00Z',
      read: false,
    });
    // A payload the Inbox can't show is left out.
    for (const bad of [
      { ...payload, target: 'ftp' },
      { ...payload, draftId: 3 },
      { ...payload, agent: undefined },
    ]) {
      expect(noticeOf(row({ kind: 'agent_went_live', payload: bad }))).toBeNull();
    }
    expect(noticeOf(row({ kind: 'agent_go_live_off', payload: { agent: 'P' } }))).toBeNull();
  });

  it('reads an AEO Operator’s summary (00545): counts and its chat, never a name of its agents', () => {
    const payload = {
      agent: 'AEO Operator',
      agentId: 'abababab-0000-4000-8000-0000000000ff',
      planId: 'f0f0f0f0-0000-4000-8000-000000000001',
      chatId: 'eeeeeeee-0000-4000-8000-0000000000ff',
      day: '2026-11-18',
      total: 4,
      done: 2,
      waiting: 1,
      failed: 0,
      stopped: 1,
      working: 0,
      notStarted: 0,
      approveAll: true,
    };
    expect(noticeOf(row({ kind: 'agent_plan_summary', payload }))).toEqual({
      id: 'n1',
      kind: 'agent_plan_summary',
      agent: 'AEO Operator',
      agentId: payload.agentId,
      chatId: payload.chatId,
      day: '2026-11-18',
      total: 4,
      done: 2,
      waiting: 1,
      failed: 0,
      stopped: 1,
      working: 0,
      notStarted: 0,
      createdAt: '2026-11-01T09:00:00Z',
      read: false,
    });
    // A count that doesn't read is none; a chat that isn't an id is no chat.
    expect(
      noticeOf(
        row({ kind: 'agent_plan_summary', payload: { ...payload, done: 'x', chatId: 'nope' } }),
      ),
    ).toMatchObject({ done: 0, chatId: null });
    for (const bad of [
      { ...payload, agent: 3 },
      { ...payload, agentId: 'agent-1' },
      { ...payload, day: 'today' },
    ]) {
      expect(noticeOf(row({ kind: 'agent_plan_summary', payload: bad }))).toBeNull();
    }
  });
});
