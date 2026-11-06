import { describe, expect, it, vi } from 'vitest';
import { readTourPrefs } from './tour-prefs';

/** A Supabase client whose reads answer from `rows`, by table. */
function fakeClient(rows: Record<string, { data: unknown; error?: unknown }>) {
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({ error: null, ...(rows[table] ?? { data: null }) }),
    };
    return chain;
  });
  return { client: { from } as never, from };
}

const ON = { tour_chat_id: 'c1', tour_topic: 'prompts', tour_finished_at: null };

describe('readTourPrefs', () => {
  it('keeps the tour chat while it is there', async () => {
    const { client } = fakeClient({
      chat_user_prefs: { data: ON },
      chat_conversations: { data: { id: 'c1' } },
    });
    expect(await readTourPrefs(client, 'u1')).toEqual(ON);
  });

  it('drops a tour chat deleted or archived mid-tour, as readTour does', async () => {
    const { client } = fakeClient({
      chat_user_prefs: { data: ON },
      chat_conversations: { data: null },
    });
    expect(await readTourPrefs(client, 'u1')).toEqual({ ...ON, tour_chat_id: null });
  });

  it('reads no chat when there is no tour on, or it is finished', async () => {
    const none = fakeClient({ chat_user_prefs: { data: { ...ON, tour_chat_id: null } } });
    expect((await readTourPrefs(none.client, 'u1'))?.tour_chat_id).toBeNull();
    expect(none.from).toHaveBeenCalledTimes(1);

    const done = { ...ON, tour_finished_at: '2026-11-06T12:00:00Z' };
    const finished = fakeClient({ chat_user_prefs: { data: done } });
    expect(await readTourPrefs(finished.client, 'u1')).toEqual(done);
    expect(finished.from).toHaveBeenCalledTimes(1);
  });

  it('is null when the prefs can’t be read', async () => {
    const { client } = fakeClient({ chat_user_prefs: { data: null, error: { message: 'no' } } });
    expect(await readTourPrefs(client, 'u1')).toBeNull();
  });
});
