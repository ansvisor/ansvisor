import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';

/**
 * What the person decided in the Content Editor beside the chat (W4-16
 * follow-up): the open page's suggestions from chat decided since the
 * chat's previous run, read from the suggestions themselves.
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
const DRAFT = '55555555-5555-4555-8555-555555555555';
const RUN = '66666666-6666-4666-8666-666666666666';
const job = { organizationId: ORG, draftId: DRAFT, conversationId: CHAT, runId: RUN };

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

beforeEach(() => {
  db.tables = {
    brands: [{ id: BRAND, organization_id: ORG }],
    content_drafts: [{ id: DRAFT, brand_id: BRAND }],
    // The chat's previous run, and this one (its time the database's own).
    chat_runs: [
      { id: 'run-1', conversation_id: CHAT, created_at: '2026-11-05T10:00:00.000Z' },
      { id: RUN, conversation_id: CHAT, created_at: '2026-11-05T10:05:00.000Z' },
    ],
    content_draft_suggestions: [],
  };
});

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
