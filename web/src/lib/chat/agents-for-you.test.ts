import { describe, expect, it } from 'vitest';
import { AGENTS_FOR_YOU_DAYS, agentsForYou, agentsForYouOpen, joinedAt } from './agents-for-you';
import { ONBOARDING_PRESET, RECOMMENDED_MAX, RECOMMENDED_MIN } from './agents/catalog';

/**
 * "Agents for you" on Chat Home (AGENTS plan §8, #11's new member half):
 * when it shows (Your work areas answered or skipped, the first 14 days in
 * the workspace, until hidden), when the person joined, and which agents:
 * Ready to use's own 3 to 5 for them.
 */

const NOW = Date.parse('2026-11-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const open = (over: Partial<Parameters<typeof agentsForYouOpen>[0]> = {}) =>
  agentsForYouOpen({
    workAreasAskedAt: daysAgo(1),
    joinedAt: daysAgo(1),
    dismissedAt: null,
    now: NOW,
    ...over,
  });

describe('when Agents for you shows', () => {
  it('shows once Your work areas is answered or skipped, in the first 14 days', () => {
    expect(AGENTS_FOR_YOU_DAYS).toBe(14);
    expect(open()).toBe(true);
    expect(open({ joinedAt: daysAgo(13.9) })).toBe(true);
    expect(open({ joinedAt: daysAgo(14) })).toBe(false);
    expect(open({ joinedAt: daysAgo(90) })).toBe(false);
  });

  it('waits for Your work areas, and stays hidden once hidden', () => {
    expect(open({ workAreasAskedAt: null })).toBe(false);
    expect(open({ dismissedAt: daysAgo(0.5) })).toBe(false);
  });

  it('shows nothing without a joined time it can read', () => {
    expect(open({ joinedAt: null })).toBe(false);
    expect(open({ joinedAt: 'not a date' })).toBe(false);
  });
});

describe('when the person joined', () => {
  it('is the invitation they accepted, else when the workspace’s maker’s account was made', () => {
    expect(joinedAt('2026-11-04T09:00:00Z', '2025-01-01T00:00:00Z')).toBe('2026-11-04T09:00:00Z');
    expect(joinedAt(null, '2026-11-01T00:00:00Z')).toBe('2026-11-01T00:00:00Z');
    expect(joinedAt(undefined, null)).toBeNull();
  });
});

describe('which agents', () => {
  it('lists 3 to 5 ready agents, those made for the site type or the work areas first, never Onboarding & Help', () => {
    const b2b = agentsForYou({ siteType: 'b2b', workAreas: [] });
    expect(b2b.length).toBeGreaterThanOrEqual(RECOMMENDED_MIN);
    expect(b2b.length).toBeLessThanOrEqual(RECOMMENDED_MAX);
    expect(b2b[0].fit).toBe('siteType');
    expect(b2b.map((a) => a.id)).not.toContain(ONBOARDING_PRESET);

    const leaders = agentsForYou({ siteType: null, workAreas: ['leaders'] });
    expect(leaders.some((a) => a.fit === 'role')).toBe(true);
    expect(leaders.length).toBeGreaterThanOrEqual(RECOMMENDED_MIN);
    // Fewer than 3 fit: agents for every brand fill the list, with no fit.
    expect(agentsForYou({ siteType: null, workAreas: [] }).every((a) => a.fit === null)).toBe(true);
  });
});
