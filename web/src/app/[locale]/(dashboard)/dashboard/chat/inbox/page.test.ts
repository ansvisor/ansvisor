// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { RUN_REQUEST_MS } from '@/lib/chat/run-limits';

/**
 * The Inbox page's request time: Approve all (a server action, which gets
 * its page's time) makes each change there and its runs go on in that
 * request's background, so it gets the run routes' 300 s, as
 * POST /api/chat/runs/{id}/approve has, and never from the 'use server'
 * file itself (#2347).
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/components/chat/chat-inbox-page', () => ({ ChatInbox: () => null }));
vi.mock('@/lib/actions/chat-notices', () => ({ readChatNotices: vi.fn() }));
vi.mock('@/lib/actions/chat-outbound', () => ({ readOutsideEmails: vi.fn() }));
vi.mock('@/lib/actions/chat-suggestions', () => ({ readDailySuggestions: vi.fn() }));
vi.mock('../_chat-page-access', () => ({ chatPageOpen: vi.fn() }));

describe('the Inbox page', () => {
  it('gives Approve all the request time the run routes have (their test ties them to it too)', async () => {
    const page = await import('./page');
    expect(page.maxDuration * 1000).toBe(RUN_REQUEST_MS);
  });
});
