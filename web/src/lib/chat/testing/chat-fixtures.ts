import { fakeId, type FakeSupabase } from './fake-supabase';

/**
 * A workspace for the activity log, Undo and idempotency tests: two
 * organizations, people in each role, a brand, an opportunity and a prompt
 * suggestion, and stand-ins for the server actions Chat's WRITE rows call,
 * writing to the same tables. Tests only.
 */

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
export const BRAND = '22222222-2222-4222-8222-222222222222';
export const OPPORTUNITY = '44444444-4444-4444-8444-444444444444';
export const SUGGESTION = '55555555-5555-4555-8555-555555555555';

export const PEOPLE = {
  admin: 'aaaaaaaa-0000-4000-8000-000000000001',
  manager: 'aaaaaaaa-0000-4000-8000-000000000002',
  analyst: 'aaaaaaaa-0000-4000-8000-000000000003',
  otherManager: 'aaaaaaaa-0000-4000-8000-000000000004',
} as const;

const iso = () => new Date().toISOString();

export function seedWorkspace(db: FakeSupabase): void {
  db.failures = {};
  db.log = [];
  db.unique = { chat_idempotency_keys: [['organization_id', 'key']] };
  db.defaults = {
    chat_activity_log: () => ({
      status: 'done',
      undone_at: null,
      undone_by: null,
      undoes_id: null,
      created_at: iso(),
    }),
    chat_idempotency_keys: () => ({ created_at: iso() }),
  };
  db.tables = {
    profiles: [
      { id: PEOPLE.admin, role: 'admin', organization_id: ORG },
      { id: PEOPLE.manager, role: 'manager', organization_id: ORG },
      { id: PEOPLE.analyst, role: 'analyst', organization_id: ORG },
      { id: PEOPLE.otherManager, role: 'manager', organization_id: ORG },
    ],
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
      { id: OTHER_ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    brands: [{ id: BRAND, organization_id: ORG }],
    chat_settings: [],
    chat_auto_choices: [],
    chat_activity_log: [],
    chat_idempotency_keys: [],
    content_drafts: [],
    content_opportunities: [
      {
        id: OPPORTUNITY,
        brand_id: BRAND,
        title: 'Pricing page for teams',
        status: 'new',
        source_data: { volume: 1200 },
        updated_at: '2026-10-28T10:00:00.000Z',
      },
    ],
    prompt_suggestions: [
      {
        id: SUGGESTION,
        brand_id: BRAND,
        suggested_text: 'best crm for startups',
        status: 'new',
        updated_at: '2026-10-28T10:00:00.000Z',
      },
    ],
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** createContentDraft: a new draft row, after a moment, as the real one takes. */
export function fakeCreateDraft(db: FakeSupabase) {
  return async (brandId: string, start: { title: string }) => {
    await sleep(5);
    const id = fakeId();
    db.tables.content_drafts.push({
      id,
      brand_id: brandId,
      title: start.title,
      body_html: `<h1>${start.title}</h1>`,
      status: 'draft',
      archived_at: null,
      updated_at: iso(),
    });
    return id;
  };
}

/** updateOpportunityStatus: the server's PATCH, reason in source_data. */
export function fakeUpdateOpportunity(db: FakeSupabase) {
  return async (id: string, status: string, reason?: string) => {
    const row = db.tables.content_opportunities.find((r) => r.id === id);
    if (!row) throw new Error('Opportunity not found');
    const rest = { ...(row.source_data as Record<string, unknown>) };
    delete rest.dismissReason;
    row.status = status;
    row.source_data = status === 'dismissed' && reason ? { ...rest, dismissReason: reason } : rest;
    row.updated_at = iso();
    return { ...row };
  };
}

/** dismissSuggestion: the server's POST …/dismiss. */
export function fakeDismissSuggestion(db: FakeSupabase) {
  return async (id: string) => {
    const row = db.tables.prompt_suggestions.find((r) => r.id === id);
    if (!row) throw new Error('Not found');
    row.status = 'dismissed';
    row.updated_at = iso();
    return { success: true };
  };
}
