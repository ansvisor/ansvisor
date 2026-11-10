// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** An action's words for the Slack post of the daily suggestion (#2139): the Action Center's own. */

const db = vi.hoisted(() => ({ row: null as unknown, error: null as unknown }));
vi.mock('@/lib/supabase/admin', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: db.row, error: db.error }),
  };
  return { supabaseAdmin: { from: () => chain } };
});
const counts = vi.hoisted(() => ({ map: new Map() }));
vi.mock('@/lib/action-center/entity-counts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/action-center/entity-counts')>()),
  readEntityCounts: async () => counts.map,
}));

const { slackActionWords } = await import('./slack-action-words');

beforeEach(() => {
  db.row = null;
  db.error = null;
  counts.map = new Map();
});

describe('slackActionWords', () => {
  it('words the action as the Action Center does', async () => {
    db.row = {
      id: 'a1',
      kind: 'close_competitor_gap',
      payload: { targetEntity: 'competitors', targets: [{ label: 'Contoso' }] },
    };
    const words = await slackActionWords('a1');
    expect(words?.title).toContain('Close the visibility gap with');
    expect(words?.description).toBe('A competitor is mentioned well more often than you.');
  });

  it('is null for an action that is gone, and throws when it can’t be read', async () => {
    await expect(slackActionWords('a1')).resolves.toBeNull();
    db.error = { message: 'timeout' };
    await expect(slackActionWords('a1')).rejects.toThrow('Could not read the action: timeout');
  });
});
