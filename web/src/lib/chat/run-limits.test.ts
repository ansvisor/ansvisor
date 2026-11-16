import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const {
  MESSAGES_PER_DAY,
  MESSAGES_PER_HOUR,
  RUNS_PER_USER,
  readBudget,
  readCap,
  MAX_NEXT_PAGES,
  PAGES_PER_READ,
  PAGE_CHARS,
  readsUsed,
  resultCharsFor,
  startDecision,
  workspaceRunLimit,
  writeCap,
} = await import('./run-limits');

/** Chat's limits (CHAT-20 §14, CHAT-04 item 5). */

const growth = { planId: 'growth' as const, isTrial: false };
const idle = { workspaceRunning: 0, userRunning: 0, messagesHour: 0, messagesDay: 0 };

describe('run limits', () => {
  it('run at once per plan: Trial 2 · Starter 3 · Growth 10 · Enterprise 30', () => {
    expect(workspaceRunLimit({ planId: 'growth', isTrial: true })).toBe(2);
    expect(workspaceRunLimit({ planId: 'starter', isTrial: false })).toBe(3);
    expect(workspaceRunLimit(growth)).toBe(10);
    expect(workspaceRunLimit({ planId: 'enterprise', isTrial: false })).toBe(30);
  });

  it('start a run, queue it while every slot is busy, refuse past the messages', () => {
    expect(startDecision(idle, growth)).toEqual({ kind: 'start' });
    expect(startDecision({ ...idle, workspaceRunning: 10 }, growth)).toEqual({ kind: 'queue' });
    expect(startDecision({ ...idle, userRunning: RUNS_PER_USER }, growth)).toEqual({
      kind: 'queue',
    });
    expect(startDecision({ ...idle, messagesHour: MESSAGES_PER_HOUR }, growth)).toEqual({
      kind: 'refuse',
      reason: 'hour',
    });
    expect(startDecision({ ...idle, messagesDay: MESSAGES_PER_DAY }, growth)).toEqual({
      kind: 'refuse',
      reason: 'day',
    });
  });

  it('give High twice and Max three times Normal’s reads', () => {
    expect(readBudget('normal')).toEqual({
      reads: 6,
      resultChars: 12_000,
      dataChars: 48_000,
      historyChars: 24_000,
    });
    expect(readBudget('high').reads).toBe(12);
    expect(readBudget('max').dataChars).toBe(144_000);
  });

  it('give a page of 50 actions room for all its rows, never less than the run’s own share', () => {
    expect(resultCharsFor(readBudget('normal'), 'list_action_center_tasks')).toBe(20_000);
    expect(resultCharsFor(readBudget('max'), 'list_action_center_tasks')).toBe(36_000);
    expect(resultCharsFor(readBudget('normal'), 'list_citations')).toBe(12_000);
  });

  it('count four next pages of a list as one read, with a ceiling of their own', () => {
    expect(PAGES_PER_READ).toBe(4);
    expect(readsUsed({ reads: 2 })).toBe(2);
    expect(readsUsed({ reads: 2, pages: 3 })).toBe(2);
    expect(readsUsed({ reads: 2, pages: 4 })).toBe(3);
    expect(readsUsed({ reads: 1, pages: MAX_NEXT_PAGES })).toBe(
      1 + MAX_NEXT_PAGES / PAGES_PER_READ,
    );
    // Within the run's 6 reads: a list of 13 pages, with one more read beside it.
    expect(1 + MAX_NEXT_PAGES / PAGES_PER_READ).toBeLessThan(readBudget('normal').reads);
  });

  it('give a page of any list read the same room (PAGE_CHARS), never less than the run’s own', () => {
    expect(resultCharsFor(readBudget('normal'), 'list_signals', true)).toBe(PAGE_CHARS);
    expect(resultCharsFor(readBudget('max'), 'list_signals', true)).toBe(36_000);
  });

  it('give an agent’s run room for its skills’ reads, scaled by effort the same way', () => {
    expect(readBudget('normal', { agent: true })).toEqual({
      reads: 10,
      resultChars: 12_000,
      dataChars: 80_000,
      historyChars: 24_000,
    });
    expect(readBudget('high', { agent: true }).reads).toBe(20);
  });

  it('cap writes per run', () => {
    expect(writeCap('create_draft')).toBe(10);
    expect(writeCap('add_competitors')).toBe(5);
    expect(writeCap('dismiss_prompt_suggestion')).toBe(10);
  });

  it('cap the pages a run opens at 10, and no other read past its budget', () => {
    expect(readCap('fetch_page')).toBe(10);
    expect(readCap('list_citations')).toBeNull();
  });
});
