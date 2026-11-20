import { describe, expect, it } from 'vitest';
import { brandGoalText } from './brand-goal';

describe('brandGoalText', () => {
  it('writes the target in its KPI’s unit, as the KPIs page does', () => {
    expect(brandGoalText('citations', 5000)).toBe('5k');
    expect(brandGoalText('citations', 21_400)).toBe('21.4k');
    expect(brandGoalText('citations', 640)).toBe('640');
    expect(brandGoalText('positive_sentiment', 62.25)).toBe('62.3%');
  });
});
