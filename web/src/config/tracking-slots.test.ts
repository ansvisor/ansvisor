import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANS } from './plans';
import { ENGINE_NAMES } from './platform-labels';
import {
  SLOT_PLATFORMS,
  SLOT_UNIT,
  STANDARD_SLOT_PLATFORMS,
  includedSlots,
  slotLookupKey,
  slotPlatform,
  slotPlatformFromStripe,
  slotUnitCents,
} from './tracking-slots';

describe('tracking slots', () => {
  it('sells 13 platforms, DeepSeek not among them', () => {
    expect(SLOT_PLATFORMS).toHaveLength(13);
    expect(slotPlatform('deepseek-web')).toBeNull();
  });

  it('prices 100 slots by group: $15, $45, $60 a month', () => {
    expect(slotUnitCents('chatgpt-web', 'month')).toBe(1500);
    expect(slotUnitCents('meta-ai-web', 'month')).toBe(4500);
    expect(slotUnitCents('perplexity-web', 'month')).toBe(6000);
    expect(slotUnitCents('copilot-app', 'year')).toBe(60000);
    expect(slotUnitCents('chatgpt-shopping', 'month')).toBeNull();
  });

  it('names the Stripe lookup keys with underscores', () => {
    expect(slotLookupKey('chatgpt-web', 'month')).toBe('addon_slots_chatgpt_web_month');
    expect(slotLookupKey('meta-ai-web', 'year')).toBe('addon_slots_meta_ai_web_year');
    expect(slotLookupKey('deepseek-web', 'month')).toBeNull();
    for (const p of SLOT_PLATFORMS) {
      expect(p.stripeId).toBe(p.id.replaceAll('-', '_'));
      expect(slotPlatformFromStripe(p.stripeId)).toBe(p);
    }
  });

  it('has a name for every platform it sells', () => {
    for (const p of SLOT_PLATFORMS) expect(ENGINE_NAMES[p.id], p.id).toBeTruthy();
  });

  it("includes Growth's 250 prompt locations on each standard platform", () => {
    const growth = includedSlots(PLANS.growth.limits);
    expect(Object.keys(growth).sort()).toEqual([...STANDARD_SLOT_PLATFORMS].sort());
    for (const id of STANDARD_SLOT_PLATFORMS) expect(growth[id]).toBe(250);
    expect(growth['perplexity-web']).toBeUndefined();
  });

  it("includes Starter's slots on its own two platforms", () => {
    expect(includedSlots(PLANS.starter.limits)).toEqual({
      'chatgpt-web': 50,
      'gemini-web': 50,
    });
  });

  it('counts 100 slots to a unit', () => {
    expect(SLOT_UNIT).toBe(100);
  });

  it('is the same list as the server copy', () => {
    const server = JSON.parse(
      readFileSync(join(__dirname, '../../../server/src/config/tracking-slots.json'), 'utf8'),
    ) as { unit: number; standard: string[]; platforms: unknown[] };
    expect(server.unit).toBe(SLOT_UNIT);
    expect(server.standard).toEqual(STANDARD_SLOT_PLATFORMS);
    expect(server.platforms).toEqual(SLOT_PLATFORMS);
  });
});
