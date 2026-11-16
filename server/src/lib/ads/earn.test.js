import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Earn card (ADS-01 §3.2): one AC-004 task naming its page, sent through
 * Chat's Send to Action Center as Ads, once per key; the action covering the
 * prompt instead of a second; logged, or taken back. Chat's send itself, and
 * its History event, are pinned in from-chat.test.js.
 */

let targets;
let deleteError;
const deletes = [];
const at = (row, path) => path.split('.').reduce((v, k) => v?.[k], row);
function from(table) {
  let rows = table === 'prompt_target_urls' ? targets : [];
  let deleting = false;
  const where = {};
  const q = {
    select: () => q,
    delete: () => ((deleting = true), q),
    eq: (col, v) => ((where[col] = v), (rows = rows.filter((r) => at(r, col) === v)), q),
    order: () => q,
    limit: (n) => ((rows = rows.slice(0, n)), q),
    then: (resolve, reject) => {
      if (deleting) deletes.push({ table, where });
      const answer = deleting ? { error: deleteError } : { data: rows, error: null };
      return Promise.resolve(answer).then(resolve, reject);
    },
  };
  return q;
}
vi.mock('../../config/supabase.js', () => ({ default: { from: (table) => from(table) } }));
const chat = { sendChatAction: vi.fn(), findCoveringActions: vi.fn() };
vi.mock('../action-center/from-chat.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendChatAction: (...a) => chat.sendChatAction(...a),
  findCoveringActions: (...a) => chat.findCoveringActions(...a),
}));
const readOpportunities = vi.fn();
vi.mock('./opportunities.js', () => ({
  SNAPSHOT_PERIOD: '30d',
  readOpportunities: (...a) => readOpportunities(...a),
}));
const logAdsActivity = vi.fn();
vi.mock('./activity.js', () => ({ logAdsActivity: (...a) => logAdsActivity(...a) }));
vi.mock('../logger.js', () => ({ logger: { error: vi.fn() } }));

const { earnProposal, readEarn, sendEarn } = await import('./earn.js');

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const P2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const PAGE = 'https://northwind.example/small-teams';
const ROW = {
  promptId: P1,
  text: 'Best CRM for sales teams under 20 reps',
  decision: 'earn_pay',
  leader: 'c1',
  leaderName: 'Kestrel CRM',
  weCited: false,
  engines: ['chatgpt-web', 'google-aio'],
  reasons: [{ code: 'rival_leads', competitorId: 'c1' }, { code: 'volume_at_least' }],
};
const Q = '“Best CRM for sales teams under 20 reps”';
const BRAND = { id: 'b1' };
const send = (key = 'key-0001') =>
  sendEarn({ brand: BRAND, orgId: 'o1', promptId: P1, userId: 'u1', idempotencyKey: key });

beforeEach(() => {
  const of = (brand_id, organization_id) => ({
    prompt_sets: { brand_id, brands: { organization_id } },
  });
  targets = [
    // The same prompt id under another organization, mapped first: never ours.
    { prompt_id: P1, url: 'https://other.example/x', prompts: of('b2', 'o2') },
    { prompt_id: P1, url: PAGE, prompts: of('b1', 'o1') },
  ];
  deleteError = null;
  deletes.length = 0;
  readOpportunities.mockReset().mockResolvedValue({ rows: [ROW] });
  chat.sendChatAction
    .mockReset()
    .mockResolvedValue({ actionId: 'a1', actionNo: 1300, created: true });
  chat.findCoveringActions.mockReset().mockResolvedValue({ covering: [] });
  logAdsActivity.mockReset().mockResolvedValue({ id: 'l1' });
});

describe('the Earn task', () => {
  it('is one task naming its target page, with Done when, from the row it fixes', () => {
    const p = earnProposal(ROW, PAGE);
    expect(p).toMatchObject({
      title: `Earn ${Q} in AI answers`,
      category: 'compete',
      impact: 'high',
      why: `Kestrel CRM leads the AI answer to ${Q}.`,
      entities: { prompts: [P1], pages: [], platforms: ['chatgpt-web', 'google-aio'] },
    });
    expect(p.tasks).toEqual([
      expect.objectContaining({
        title: `Refresh /small-teams to answer ${Q}`,
        type: 'on_page',
        url: PAGE,
        done_when: `/small-teams answers ${Q} in its first paragraph, and it is live.`,
      }),
    ]);
    expect(p.tasks[0].how).toContain('Say plainly how you compare with Kestrel CRM');
  });

  it('is a new page to write when none is mapped, and says why from who leads', () => {
    const open = earnProposal({ ...ROW, decision: 'earn', leader: 'none', reasons: [] }, null);
    expect(open).toMatchObject({ category: 'growth', impact: 'medium' });
    expect(open.why).toBe(`No one leads the AI answer to ${Q} yet.`);
    expect(open.tasks[0]).toMatchObject({
      title: `Write a new page that answers ${Q}`,
      type: 'content',
      where: `A new page on your site for ${Q}`,
      done_when: `The new page answers ${Q} in its first paragraph, and it is live.`,
    });
    expect(open.tasks[0].url).toBeUndefined();
    const ours = earnProposal({ ...ROW, leader: 'us', reasons: [{ code: 'we_lead' }] }, PAGE);
    expect(ours.category).toBe('protect');
  });
});

describe('sendEarn', () => {
  it("sends it as Ads once per key, with the brand's own target page, and logs it", async () => {
    await expect(send()).resolves.toEqual({
      promptId: P1,
      action: { id: 'a1', no: 1300 },
      created: true,
      covered: false,
    });
    expect(readOpportunities).toHaveBeenCalledWith({ brand: BRAND, orgId: 'o1', period: '30d' });
    const [brandId, opts] = chat.sendChatAction.mock.lastCall;
    expect(brandId).toBe('b1');
    expect(opts).toMatchObject({
      userId: 'u1',
      idempotencyKey: `ads:${P1}:key-0001`,
      source: 'ads',
    });
    expect(opts.proposal.tasks[0].url).toBe(PAGE);
    expect(logAdsActivity).toHaveBeenCalledExactlyOnceWith({
      orgId: 'o1',
      brandId: 'b1',
      actor: { userId: 'u1' },
      event: 'earn.sent',
      target: { promptId: P1, actionId: 'a1' },
      after: { actionNo: 1300, decision: 'earn_pay', page: PAGE },
    });
    // The same key again: what it made, logged once.
    chat.sendChatAction.mockResolvedValue({ actionId: 'a1', actionNo: 1300, created: false });
    await expect(send()).resolves.toMatchObject({ created: false, covered: false });
    expect(chat.sendChatAction.mock.lastCall[1].idempotencyKey).toBe(`ads:${P1}:key-0001`);
    expect(logAdsActivity).toHaveBeenCalledOnce();
  });

  it('answers the active action that covers the prompt: no second one, nothing logged', async () => {
    chat.sendChatAction.mockRejectedValue(
      Object.assign(new Error('AC-1258 already covers this.'), {
        status: 409,
        code: 'duplicate',
        extra: { action: { id: 'a9', no: 1258, covers: 'all' } },
      }),
    );
    await expect(send()).resolves.toEqual({
      promptId: P1,
      action: { id: 'a9', no: 1258 },
      created: false,
      covered: true,
    });
    expect(logAdsActivity).not.toHaveBeenCalled();
  });

  it("answers the action's number in its brand once the brand is numbered (00534)", async () => {
    chat.sendChatAction.mockResolvedValue({
      actionId: 'a1',
      actionNo: 1300,
      brandNo: 12,
      created: true,
    });
    await expect(send()).resolves.toMatchObject({ action: { id: 'a1', no: 1300, brandNo: 12 } });
    chat.sendChatAction.mockRejectedValue(
      Object.assign(new Error('AC-03 already covers this.'), {
        status: 409,
        code: 'duplicate',
        extra: { action: { id: 'a9', no: 1258, brandNo: 3, covers: 'all' } },
      }),
    );
    await expect(send()).resolves.toMatchObject({ action: { id: 'a9', no: 1258, brandNo: 3 } });
  });

  it("reads a prompt that isn't one of the brand's opportunities as not found", async () => {
    readOpportunities.mockResolvedValue({ rows: [{ ...ROW, promptId: P2 }] });
    await expect(send()).rejects.toMatchObject({ status: 404 });
    expect(chat.sendChatAction).not.toHaveBeenCalled();
  });

  it('takes the action back when the log cannot hold it', async () => {
    logAdsActivity.mockRejectedValue(new Error('ads activity write failed: down'));
    await expect(send()).rejects.toThrow('ads activity write failed: down');
    expect(deletes).toEqual([{ table: 'actions', where: { id: 'a1', brand_id: 'b1' } }]);
  });
});

describe('readEarn', () => {
  it('gives the drawer the target page and the active action covering the prompt', async () => {
    chat.findCoveringActions.mockResolvedValue({
      covering: [{ actionId: 'a9', actionNo: 1258, covers: 'all' }],
    });
    await expect(readEarn('b1', 'o1', P1)).resolves.toEqual({
      page: PAGE,
      action: { id: 'a9', no: 1258 },
    });
    expect(chat.findCoveringActions).toHaveBeenCalledWith('b1', {
      prompts: [P1],
      pages: [],
      competitors: [],
      platforms: [],
    });
    chat.findCoveringActions.mockResolvedValue({
      covering: [{ actionId: 'a9', actionNo: 1258, brandNo: 3, covers: 'all' }],
    });
    await expect(readEarn('b1', 'o1', P1)).resolves.toMatchObject({
      action: { id: 'a9', no: 1258, brandNo: 3 },
    });
    chat.findCoveringActions.mockResolvedValue({ covering: [] });
    await expect(readEarn('b1', 'o1', P2)).resolves.toEqual({ page: null, action: null });
  });
});
