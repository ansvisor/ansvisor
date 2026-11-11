import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { businessHub, businessHubRows } = await import('./business-hub.js');
const { TOPICS } = await import('./brewline.js');

/**
 * The demo brand's ChatGPT Business Hub numbers (00526): four weekly
 * entries, the newest ending yesterday, so Visibility's card shows them.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-11-11T08:30:00Z');

describe('businessHubRows', () => {
  const rows = businessHubRows({ brandId: BRAND_ID, now: NOW });

  it('enters four weeks back to back, the newest ending yesterday', () => {
    expect(rows.map((r) => [r.period_days, r.period_end])).toEqual([
      [7, '2026-10-20'],
      [7, '2026-10-27'],
      [7, '2026-11-03'],
      [7, '2026-11-10'],
    ]);
    for (const row of rows) {
      expect(row.brand_id).toBe(BRAND_ID);
      expect(row.source).toBe('manual');
      expect(row.entered_by).toBeNull();
      expect(Date.parse(row.created_at)).toBeLessThanOrEqual(NOW.getTime());
      expect(row.created_at > row.period_end).toBe(true);
    }
  });

  it('keeps the same ids from one build to the next, a week moving on with its end', () => {
    expect(businessHubRows({ brandId: BRAND_ID, now: NOW }).map((r) => r.id)).toEqual(
      rows.map((r) => r.id),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  });

  it('shows one week without Profile views, and topics the table takes', () => {
    expect(rows.filter((r) => r.profile_views === null)).toHaveLength(1);
    for (const row of rows) {
      for (const n of [row.mentions, row.website_clicks]) {
        expect(Number.isInteger(n) && n >= 0).toBe(true);
      }
      expect(row.discovery_topics.length).toBeLessThanOrEqual(5);
      expect(new Set(row.discovery_topics.map((t) => t.toLowerCase())).size).toBe(
        row.discovery_topics.length,
      );
      for (const topic of row.discovery_topics) {
        expect(topic.length).toBeGreaterThan(0);
        expect(topic.length).toBeLessThanOrEqual(120);
      }
    }
    // Some are the demo's own tracked topics, so the card can say they're tracked.
    const tracked = new Set(TOPICS.map((t) => t.name));
    expect(rows.at(-1).discovery_topics.filter((t) => tracked.has(t)).length).toBeGreaterThan(0);
  });
});

describe('businessHub', () => {
  it('writes its rows through the build’s writer, in place', async () => {
    const write = vi.fn();
    expect(businessHub).toMatchObject({ inPlace: true, tables: ['business_hub_snapshots'] });
    expect(await businessHub.build({ brandId: BRAND_ID, now: NOW, write })).toEqual({
      snapshots: 4,
    });
    expect(write).toHaveBeenCalledWith('business_hub_snapshots', expect.any(Array));
  });
});
