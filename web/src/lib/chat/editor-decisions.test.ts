import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';

/**
 * What the person decided in the Content Editor beside the chat (W4-16
 * follow-up): the open page's suggestions from chat decided since the
 * chat's previous run, read from the suggestions themselves, and only on a
 * page of a brand the person may see (BRAND-ACCESS, 00388).
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { decisionCount, editorDecisionsBlock, readEditorDecisions, MAX_DECISIONS } =
  await import('./editor-decisions');

const ORG = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const OTHER_BRAND = '44444444-4444-4444-8444-444444444444';
const DRAFT = '55555555-5555-4555-8555-555555555555';
const RUN = '66666666-6666-4666-8666-666666666666';
const PERSON = '77777777-7777-4777-8777-777777777777';
const job = {
  organizationId: ORG,
  userId: PERSON,
  draftId: DRAFT,
  conversationId: CHAT,
  runId: RUN,
};

const suggestion = (
  status: 'open' | 'accepted' | 'rejected',
  reason: string,
  decidedAt: string | null,
  ruleKeys = ['chat'],
) => ({
  id: `${reason}-${status}`,
  draft_id: DRAFT,
  status,
  reason,
  rule_keys: ruleKeys,
  decided_at: decidedAt,
});

/** Whom can_access_brand was asked about. */
let askedAbout: unknown[];

beforeEach(() => {
  askedAbout = [];
  db.tables = {
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: OTHER_BRAND, organization_id: ORG, is_demo: false },
    ],
    // Everyone starts with All brands (00388).
    profiles: [{ id: PERSON, organization_id: ORG, role: 'analyst', brand_scope: 'all' }],
    member_brands: [],
    content_drafts: [{ id: DRAFT, brand_id: BRAND }],
    // The chat's previous run, and this one (its time the database's own).
    chat_runs: [
      { id: 'run-1', conversation_id: CHAT, created_at: '2026-11-05T10:00:00.000Z' },
      { id: RUN, conversation_id: CHAT, created_at: '2026-11-05T10:05:00.000Z' },
    ],
    content_draft_suggestions: [],
  };
  // can_access_brand (00388) over the fake's tables.
  db.rpcs.can_access_brand = ({ p_brand_id, p_user_id }) => {
    askedAbout.push(p_user_id);
    const brand = db.tables.brands.find((b) => b.id === p_brand_id);
    const person = db.tables.profiles.find((p) => p.id === p_user_id);
    if (!brand || !person || person.organization_id !== brand.organization_id) return false;
    return (
      person.role === 'admin' ||
      person.brand_scope === 'all' ||
      brand.is_demo === true ||
      db.tables.member_brands.some((m) => m.user_id === person.id && m.brand_id === brand.id)
    );
  };
});

/** An Admin narrows the person to Selected brands: these (00388). */
const narrowTo = (...brandIds: string[]) => {
  db.tables.profiles[0].brand_scope = 'selected';
  db.tables.member_brands = brandIds.map((brand_id) => ({
    user_id: PERSON,
    organization_id: ORG,
    brand_id,
  }));
};

describe('readEditorDecisions', () => {
  it('reads the suggestions from chat decided since the previous run, newest first', async () => {
    db.tables.content_draft_suggestions.push(
      suggestion('accepted', 'Shorter answer 3', '2026-11-05T10:02:00.000Z'),
      suggestion('rejected', 'Add a refund question', '2026-11-05T10:03:00.000Z'),
      suggestion('accepted', 'Open with the price', '2026-11-05T10:04:00.000Z'),
      // Decided before the previous run, still open, or not from chat: not told.
      suggestion('accepted', 'Older', '2026-11-05T09:59:00.000Z'),
      suggestion('open', 'Still open', null),
      suggestion('rejected', 'From Fix open rules', '2026-11-05T10:03:30.000Z', ['length']),
    );
    const decisions = await readEditorDecisions(job);
    expect(decisions).toEqual({
      accepted: ['Open with the price', 'Shorter answer 3'],
      rejected: ['Add a refund question'],
    });
    expect(decisionCount(decisions)).toBe(3);
  });

  it('tells nothing on the chat’s first run, for a page outside the workspace, or with nothing decided', async () => {
    db.tables.content_draft_suggestions.push(
      suggestion('accepted', 'Shorter answer 3', '2026-11-05T10:02:00.000Z'),
    );
    expect(await readEditorDecisions({ ...job, runId: 'run-1' })).toBeNull();
    db.tables.chat_runs = db.tables.chat_runs.filter((run) => run.id === RUN);
    expect(await readEditorDecisions(job)).toBeNull();

    db.tables.chat_runs.push({
      id: 'run-1',
      conversation_id: CHAT,
      created_at: '2026-11-05T10:00:00.000Z',
    });
    db.tables.brands = [{ id: BRAND, organization_id: '99999999-9999-4999-8999-999999999999' }];
    expect(await readEditorDecisions(job)).toBeNull();

    db.tables.brands = [{ id: BRAND, organization_id: ORG }];
    db.tables.content_draft_suggestions = [];
    expect(await readEditorDecisions(job)).toBeNull();
    expect(decisionCount(null)).toBe(0);
  });

  it('tells a Selected-brands person nothing on a page of a brand not shared with them', async () => {
    db.tables.content_draft_suggestions.push(
      suggestion('accepted', 'Shorter answer 3', '2026-11-05T10:02:00.000Z'),
    );
    narrowTo(OTHER_BRAND);
    expect(await readEditorDecisions(job)).toBeNull();
    // Asked about the person the run acts for.
    expect(askedAbout).toEqual([PERSON]);

    // No brands shared at all: the same.
    narrowTo();
    expect(await readEditorDecisions(job)).toBeNull();
  });

  it('tells a person with the page’s brand shared, All brands, or an Admin', async () => {
    db.tables.content_draft_suggestions.push(
      suggestion('accepted', 'Shorter answer 3', '2026-11-05T10:02:00.000Z'),
    );
    const told = { accepted: ['Shorter answer 3'], rejected: [] };

    narrowTo(OTHER_BRAND, BRAND);
    expect(await readEditorDecisions(job)).toEqual(told);

    narrowTo(OTHER_BRAND);
    db.tables.profiles[0].role = 'admin';
    expect(await readEditorDecisions(job)).toEqual(told);

    db.tables.profiles[0].role = 'analyst';
    db.tables.profiles[0].brand_scope = 'all';
    expect(await readEditorDecisions(job)).toEqual(told);
  });

  it(`tells at most ${MAX_DECISIONS}, each reason cut to fit`, async () => {
    for (let i = 0; i < MAX_DECISIONS + 3; i++) {
      db.tables.content_draft_suggestions.push(
        suggestion(
          'accepted',
          `${i}`.padStart(2, '0') + 'x'.repeat(300),
          `2026-11-05T10:0${Math.floor(i / 10) + 1}:${String(i % 10).padStart(2, '0')}.000Z`,
        ),
      );
    }
    const decisions = await readEditorDecisions(job);
    expect(decisions!.accepted).toHaveLength(MAX_DECISIONS);
    expect(decisions!.accepted[0].startsWith('12')).toBe(true);
    expect(decisions!.accepted[0]).toHaveLength(200);
    expect(decisions!.accepted[0].endsWith('…')).toBe(true);
  });
});

describe('editorDecisionsBlock', () => {
  it('gives the model the decisions as data, with how to take them', () => {
    const block = editorDecisionsBlock({ accepted: ['Shorter answer 3'], rejected: ['<b>x</b>'] });
    expect(block).toContain("don't suggest a rejected change again unless they ask");
    expect(block).toContain('<app_data source="editor_decisions">');
    expect(block).toContain('"accepted":["Shorter answer 3"]');
  });
});
