// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The product tour's turns (owner decision 2026-11-06; 00486): kept as the
 * person's own "Ansvisor tour" chat, each topic adding the line they
 * clicked and the page's scripted explanation with no run, in their answer
 * language; End the tour adds the last line and keeps the tour ended.
 */

const session = vi.hoisted(() => ({ user: { id: 'user-1' } as { id: string } | null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { organization_id: 'org-1' } }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
const access = vi.hoisted(() => ({ canAccessBrand: vi.fn() }));
vi.mock('@/lib/brand-access', () => access);
const touched = vi.hoisted(() => ({ startTouchedBrands: vi.fn() }));
vi.mock('@/lib/chat/touched-brands', () => touched);
// The brand's runs: none completed and none going, unless a test says so.
const tracking = vi.hoisted(() => ({ getTrackingWindow: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => tracking);
const model = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: model.generateText,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { endChatTour, prepareChatTour, showTourTopic } = await import('./chat-tour');
const { englishScript, scriptHash } = await import('@/lib/chat/tour-script');

const english = englishScript();
const messages = () =>
  (db.tables.chat_messages ?? []).map((m) => ({ role: m.role, text: m.content_md }));
const RUNS_DONE = { lastRunAt: '2026-11-06T08:00:00.000Z', activeRun: null };
const prefs = () => db.tables.chat_user_prefs?.[0];

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
  session.user = { id: 'user-1' };
  db.tables = {};
  db.failures = {};
  db.log = [];
  access.canAccessBrand.mockReset().mockResolvedValue(true);
  touched.startTouchedBrands.mockReset();
  model.generateText.mockReset();
  tracking.getTrackingWindow.mockReset().mockResolvedValue(RUNS_DONE);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('showTourTopic', () => {
  it("starts the person's tour chat on its first topic, about the brand on screen", async () => {
    const result = await showTourTopic({ topic: 'visibility', via: 'topic', brandId: 'brand-1' });
    expect(result).toEqual({ ok: true, chatId: expect.any(String) });
    const chatId = (result as { chatId: string }).chatId;
    expect(db.tables.chat_conversations).toEqual([
      expect.objectContaining({
        id: chatId,
        organization_id: 'org-1',
        user_id: 'user-1',
        brand_id: 'brand-1',
        title: 'Ansvisor tour',
        origin: 'panel',
        origin_page: '/dashboard/insights',
      }),
    ]);
    expect(access.canAccessBrand).toHaveBeenCalledWith('user-1', 'brand-1', 'org-1');
    expect(touched.startTouchedBrands).toHaveBeenCalledWith(chatId);
    // Scripted, with no run and no model.
    expect(messages()).toEqual([
      { role: 'user', text: 'Show me Visibility' },
      { role: 'assistant', text: english['body.visibility'] },
    ]);
    expect(db.tables.chat_runs ?? []).toEqual([]);
    expect(model.generateText).not.toHaveBeenCalled();
    expect(prefs()).toMatchObject({
      user_id: 'user-1',
      tour_chat_id: chatId,
      tour_topic: 'visibility',
      tour_finished_at: null,
    });
  });

  it('adds each next topic to the same chat, in order', async () => {
    const first = await showTourTopic({ topic: 'visibility', via: 'everything', brandId: null });
    const second = await showTourTopic({ topic: 'prompts', via: 'next', brandId: 'brand-1' });
    expect(second).toEqual(first);
    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(db.tables.chat_conversations[0].brand_id).toBeNull();
    expect(messages().map((m) => m.text)).toEqual([
      'Show me everything',
      english['body.visibility'],
      'Next: Topics and prompts',
      english['body.prompts'],
    ]);
    expect(prefs()).toMatchObject({ tour_topic: 'prompts' });
  });

  it('starts a new chat when the tour chat is gone, archived or not the person’s', async () => {
    db.tables.chat_conversations = [
      { id: 'gone', user_id: 'user-1', organization_id: 'org-1', deleted_at: '2026-11-06' },
    ];
    db.tables.chat_user_prefs = [{ user_id: 'user-1', tour_chat_id: 'gone' }];
    const result = await showTourTopic({ topic: 'content', via: 'topic' });
    expect(result).toEqual({ ok: true, chatId: expect.not.stringMatching(/^gone$/) });

    db.tables.chat_conversations.push({
      id: 'theirs',
      user_id: 'user-2',
      organization_id: 'org-1',
      deleted_at: null,
      archived_at: null,
    });
    db.tables.chat_user_prefs = [{ user_id: 'user-1', tour_chat_id: 'theirs' }];
    const again = await showTourTopic({ topic: 'content', via: 'topic' });
    expect((again as { chatId: string }).chatId).not.toBe('theirs');
    // Nothing was added to the deleted chat or to someone else's.
    const added = new Set((db.tables.chat_messages ?? []).map((m) => m.conversation_id));
    expect(added.has('gone') || added.has('theirs')).toBe(false);
  });

  it('keeps the chat about the workspace when the person may not use the brand', async () => {
    access.canAccessBrand.mockResolvedValue(false);
    await showTourTopic({ topic: 'visibility', via: 'topic', brandId: 'brand-2' });
    expect(db.tables.chat_conversations[0].brand_id).toBeNull();
  });

  it("writes the turns in the person's answer language, kept for everyone", async () => {
    const german = Object.fromEntries(Object.entries(english).map(([k, v]) => [k, `DE ${v}`]));
    db.tables.chat_user_prefs = [{ user_id: 'user-1', answer_language: 'de' }];
    db.tables.chat_tour_translations = [
      { lang: 'de', source_hash: scriptHash(english), texts: german, model: 'm' },
    ];
    await showTourTopic({ topic: 'positions', via: 'topic' });
    expect(messages()).toEqual([
      { role: 'user', text: german['show.positions'] },
      { role: 'assistant', text: german['body.positions'] },
    ]);
    expect(model.generateText).not.toHaveBeenCalled();
  });

  it('refuses a topic or a way it does not know, the new Chat off, or no session', async () => {
    expect(await showTourTopic({ topic: 'billing', via: 'topic' })).toEqual({ ok: false });
    expect(await showTourTopic({ topic: 'content', via: 'jump' })).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await showTourTopic({ topic: 'content', via: 'topic' })).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    session.user = null;
    expect(await showTourTopic({ topic: 'content', via: 'topic' })).toEqual({ ok: false });
    expect(db.log).toEqual([]);
  });

  it('answers a failed write as a value', async () => {
    db.failures.chat_messages = { message: 'down' };
    expect(await showTourTopic({ topic: 'content', via: 'topic' })).toEqual({ ok: false });
  });
});

describe('endChatTour', () => {
  it('adds the last line to the tour chat and keeps the tour ended', async () => {
    const started = await showTourTopic({ topic: 'connections', via: 'topic' });
    const ended = await endChatTour();
    expect(ended).toEqual(started);
    expect(messages().slice(-2)).toEqual([
      { role: 'user', text: 'End the tour' },
      { role: 'assistant', text: english.endLine },
    ]);
    expect(prefs()?.tour_finished_at).toEqual(expect.any(String));
    expect(prefs()?.tour_topic).toBe('connections');
  });

  it('ends the tour even when its chat is gone', async () => {
    expect(await endChatTour()).toEqual({ ok: true, chatId: null });
    expect(messages()).toEqual([]);
    expect(prefs()?.tour_finished_at).toEqual(expect.any(String));
  });

  it('takes the tour again from the start after it ended', async () => {
    await showTourTopic({ topic: 'content', via: 'topic' });
    await endChatTour();
    await showTourTopic({ topic: 'visibility', via: 'everything' });
    expect(prefs()).toMatchObject({ tour_topic: 'visibility', tour_finished_at: null });
    expect(db.tables.chat_conversations).toHaveLength(1);
  });
});

describe('prepareChatTour', () => {
  it('translates the tour ahead for a person who reads another language, and nothing for English', async () => {
    await prepareChatTour();
    expect(model.generateText).not.toHaveBeenCalled();

    db.tables.chat_user_prefs = [{ user_id: 'user-1', answer_language: 'tr' }];
    model.generateText.mockResolvedValue({
      text: JSON.stringify(
        Object.fromEntries(Object.entries(english).map(([k, v]) => [k, `TR ${v}`])),
      ),
    });
    await prepareChatTour();
    expect(model.generateText).toHaveBeenCalledTimes(1);
    expect(db.tables.chat_tour_translations).toHaveLength(1);
  });
});

describe('showTourTopic, while the first tracking run goes on', () => {
  const RUNNING = {
    lastRunAt: null,
    activeRun: { startedAt: '2026-11-06T09:00:00Z', source: 'pay' },
  };

  it("marks the person's line with its topic, so the panel finds the page's turn", async () => {
    await showTourTopic({ topic: 'content', via: 'topic', brandId: 'brand-1' });
    expect(db.tables.chat_messages.map((m) => m.context_json ?? null)).toEqual([
      { tour: 'content' },
      null,
    ]);
    await endChatTour();
    expect(db.tables.chat_messages.at(-2)?.context_json ?? null).toBeNull();
  });

  it('ends the turn with when the first results are in, from what the browser saw', async () => {
    tracking.getTrackingWindow.mockResolvedValue(RUNNING);
    await showTourTopic({
      topic: 'visibility',
      via: 'topic',
      brandId: 'brand-1',
      firstRun: { minutes: 14 },
    });
    expect(tracking.getTrackingWindow).toHaveBeenCalledWith('brand-1');
    expect(messages()[1].text).toBe(
      `${english['body.visibility']}\n\nYour first results are still coming in (about 14 min); this page fills in as they arrive.`,
    );
  });

  it('says it without a time when the browser saw none, in hours from 90 minutes', async () => {
    tracking.getTrackingWindow.mockResolvedValue(RUNNING);
    await showTourTopic({ topic: 'content', via: 'topic', brandId: 'brand-1' });
    expect(messages()[1].text).toMatch(/still coming in; this page fills in as they arrive\.$/);
    await showTourTopic({
      topic: 'connections',
      via: 'next',
      brandId: 'brand-1',
      firstRun: { minutes: 125 },
    });
    expect(messages()[3].text).toMatch(/\(about 2 h\)/);
  });

  it('adds nothing once the brand has results, without a brand, or when its runs can’t be read', async () => {
    await showTourTopic({
      topic: 'content',
      via: 'topic',
      brandId: 'brand-1',
      firstRun: { minutes: 5 },
    });
    expect(messages()[1].text).toBe(english['body.content']);
    await showTourTopic({ topic: 'content', via: 'topic', firstRun: { minutes: 5 } });
    expect(messages()[3].text).toBe(english['body.content']);
    tracking.getTrackingWindow.mockRejectedValue(new Error('down'));
    await showTourTopic({
      topic: 'content',
      via: 'topic',
      brandId: 'brand-1',
      firstRun: { minutes: 5 },
    });
    expect(messages()[5].text).toBe(english['body.content']);
  });

  it('trusts the browser only while no run completed: a queued first run counts', async () => {
    tracking.getTrackingWindow.mockResolvedValue({ lastRunAt: null, activeRun: null });
    await showTourTopic({ topic: 'content', via: 'topic', brandId: 'brand-1' });
    expect(messages()[1].text).toBe(english['body.content']);
    await showTourTopic({
      topic: 'content',
      via: 'topic',
      brandId: 'brand-1',
      firstRun: { minutes: null },
    });
    expect(messages()[3].text).toMatch(/still coming in; this page fills in/);
  });
});
