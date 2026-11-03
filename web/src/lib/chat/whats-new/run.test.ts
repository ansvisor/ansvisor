import { describe, expect, it } from 'vitest';
import { updatesOf, whatsNewStepDetail } from './run';

/** What's new's one step (CHAT-11 item 11): "Read What's new · 3 updates for your plan". */
describe('whatsNewStepDetail', () => {
  it('counts the updates the read found for the plan', () => {
    expect(whatsNewStepDetail({ updates: [{}, {}, {}] })).toBe('3 updates for your plan');
    expect(whatsNewStepDetail({ updates: [{}] })).toBe('1 update for your plan');
    expect(whatsNewStepDetail({ updates: [] })).toBe('Nothing new for your plan');
    expect(whatsNewStepDetail(null)).toBe('Nothing new for your plan');
    expect(updatesOf({ updates: 'x' })).toEqual([]);
  });
});
