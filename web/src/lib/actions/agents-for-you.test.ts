// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Chat Home's "Agents for you" read (AGENTS plan §8, #11's new member
 * half): for the open brand, Ready to use's own 3 to 5 agents for its site
 * type and the person's work areas, while the section is open for them —
 * Your work areas answered or skipped, joined in the last 14 days (the
 * invitation they accepted, or, for the workspace's maker, their account),
 * not hidden (00483) — with whether they may turn one on. Only with the new
 * Chat on, and answered as a value, never thrown (#1777).
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const BRAND = 'bbbbbbbb-0000-4000-8000-000000000001';
const FOREIGN_BRAND = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const db = vi.hoisted(() => ({
  person: null as unknown,
  admin: null as unknown,
  user: null as { id: string; email?: string } | null,
}));
vi.mock('@/lib/supabase/server', async () => {
  const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
  const fake = createFakeSupabase();
  db.person = fake;
  return {
    createClient: async () =>
      Object.assign(fake, { auth: { getUser: async () => ({ data: { user: db.user } }) } }),
  };
});
vi.mock('@/lib/supabase/admin', async () => {
  const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
  const fake = createFakeSupabase();
  db.admin = fake;
  return { supabaseAdmin: fake };
});

const { readAgentsForYou, readAgentsForYouOpen } = await import('./agents-for-you');
const person = () => db.person as FakeSupabase;
const admin = () => db.admin as FakeSupabase;
const profile = () => person().tables.profiles[0];
const accepted = (over: Record<string, unknown> = {}) =>
  admin().tables.invitations.push({
    id: `inv-${admin().tables.invitations.length}`,
    organization_id: ORG,
    email: 'sam@acme.example',
    status: 'accepted',
    accepted_at: daysAgo(2),
    ...over,
  });

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  db.user = { id: ME, email: 'Sam@Acme.example' };
  person().failures = {};
  person().tables = {
    profiles: [
      {
        id: ME,
        organization_id: ORG,
        role: 'manager',
        work_areas: ['leaders'],
        work_areas_asked_at: daysAgo(2),
        // An account older than the workspace: it joined from an invitation.
        created_at: daysAgo(400),
      },
    ],
    chat_user_prefs: [],
    brands: [
      {
        id: BRAND,
        organization_id: ORG,
        site_type: 'b2b',
        industry: null,
        shopping_mode_enabled: false,
      },
      {
        id: FOREIGN_BRAND,
        organization_id: OTHER_ORG,
        site_type: 'ecommerce',
        industry: null,
        shopping_mode_enabled: false,
      },
    ],
  };
  admin().failures = {};
  admin().tables = { invitations: [] };
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

const shown = (result: Awaited<ReturnType<typeof readAgentsForYou>>) =>
  result.ok ? result.agents.map((a) => a.id) : null;

describe('readAgentsForYou', () => {
  it('lists the agents for a member who joined 2 days ago, for the site type and their work areas', async () => {
    accepted();
    const result = await readAgentsForYou(BRAND);
    expect(result).toMatchObject({ ok: true, canTurnOn: true });
    if (!result.ok) throw new Error('not read');
    expect(result.agents.length).toBeGreaterThanOrEqual(3);
    expect(result.agents.length).toBeLessThanOrEqual(5);
    // B2B's agents first, then the one made for Founders & leaders.
    expect(result.agents[0].fit).toBe('siteType');
    expect(result.agents).toContainEqual({ id: 'ceo-brief', fit: 'role' });
    expect(result.agents.map((a) => a.id)).not.toContain('onboarding-help');
  });

  it('counts from the invitation accepted to this workspace, not an old account', async () => {
    // No invitation to this workspace: the account is 400 days old.
    accepted({ organization_id: OTHER_ORG });
    accepted({ email: 'someone@else.example' });
    accepted({ status: 'pending', accepted_at: null });
    expect(await readAgentsForYou(BRAND)).toEqual({ ok: true, agents: [], canTurnOn: true });
    // Joined 15 days ago: past the 14.
    accepted({ accepted_at: daysAgo(15) });
    expect(shown(await readAgentsForYou(BRAND))).toEqual([]);
    accepted({ accepted_at: daysAgo(13) });
    expect(shown(await readAgentsForYou(BRAND))?.length).toBeGreaterThanOrEqual(3);
  });

  it('counts from the account of whoever made the workspace', async () => {
    profile().created_at = daysAgo(3);
    expect(shown(await readAgentsForYou(BRAND))?.length).toBeGreaterThanOrEqual(3);
    profile().created_at = daysAgo(20);
    expect(shown(await readAgentsForYou(BRAND))).toEqual([]);
  });

  it('waits for Your work areas, and stays hidden once hidden (00483)', async () => {
    accepted();
    profile().work_areas_asked_at = null;
    expect(shown(await readAgentsForYou(BRAND))).toEqual([]);
    profile().work_areas_asked_at = daysAgo(1);
    person().tables.chat_user_prefs.push({ user_id: ME, agents_for_you_dismissed_at: daysAgo(1) });
    expect(shown(await readAgentsForYou(BRAND))).toEqual([]);
  });

  it('lets Admins and Managers turn one on; Analysts and Agency partners ask their Admin', async () => {
    accepted();
    for (const [role, canTurnOn] of [
      ['admin', true],
      ['manager', true],
      ['analyst', false],
      ['agency_partner', false],
    ] as const) {
      profile().role = role;
      const result = await readAgentsForYou(BRAND);
      expect(result).toMatchObject({ ok: true, canTurnOn });
      expect(shown(result)?.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('reads nothing for a brand outside the workspace, a bad id, signed out or with the new Chat off', async () => {
    accepted();
    expect(await readAgentsForYou(FOREIGN_BRAND)).toEqual({ ok: false });
    expect(await readAgentsForYou('nope')).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC_ORGS', OTHER_ORG);
    expect(await readAgentsForYou(BRAND)).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    db.user = null;
    expect(await readAgentsForYou(BRAND)).toEqual({ ok: false });
  });

  it('answers a failed read as a value', async () => {
    admin().failures.invitations = { message: 'down' };
    expect(await readAgentsForYou(BRAND)).toEqual({ ok: false });
    expect(errorLog).toHaveBeenCalled();
  });
});

describe('readAgentsForYouOpen (the Default view, owner 2026-11-06)', () => {
  it('is true for a new member, whether invited or the workspace’s maker', async () => {
    accepted();
    expect(await readAgentsForYouOpen()).toBe(true);
    admin().tables.invitations = [];
    profile().created_at = daysAgo(3);
    expect(await readAgentsForYouOpen()).toBe(true);
  });

  it('is false for anyone else: joined 15 days ago, work areas not asked yet, or hidden (00483)', async () => {
    // An account 400 days old and no invitation to this workspace.
    expect(await readAgentsForYouOpen()).toBe(false);
    accepted({ accepted_at: daysAgo(15) });
    expect(await readAgentsForYouOpen()).toBe(false);
    accepted();
    profile().work_areas_asked_at = null;
    expect(await readAgentsForYouOpen()).toBe(false);
    profile().work_areas_asked_at = daysAgo(1);
    person().tables.chat_user_prefs.push({ user_id: ME, agents_for_you_dismissed_at: daysAgo(1) });
    expect(await readAgentsForYouOpen()).toBe(false);
  });

  it('is false signed out, with the new Chat off, or when a read fails', async () => {
    accepted();
    vi.stubEnv('CHAT_AGENTIC_ORGS', OTHER_ORG);
    expect(await readAgentsForYouOpen()).toBe(false);
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    db.user = null;
    expect(await readAgentsForYouOpen()).toBe(false);
    db.user = { id: ME, email: 'Sam@Acme.example' };
    admin().failures.invitations = { message: 'down' };
    expect(await readAgentsForYouOpen()).toBe(false);
    expect(errorLog).toHaveBeenCalled();
  });
});
