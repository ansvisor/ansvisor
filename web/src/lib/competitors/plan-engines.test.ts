import { describe, expect, it } from 'vitest';
import { PLANS } from '@/config/plans';
import { breakdownForPlan, planEngineKeys } from './plan-engines';

const row = (platform: string, brandScore = 40, competitorScore = 30) => ({
  platform,
  brandScore,
  competitorScore,
  diff: brandScore - competitorScore,
});

describe('the Platform Breakdown keeps to the plan (UX audit CP-04)', () => {
  it("reads Growth's scraped engines, Copilot (Bing AI Mode) among them, and not Claude", () => {
    const keys = planEngineKeys(PLANS.growth.limits.allowedScrapers, []);
    expect([...keys].sort()).toEqual([
      'copilot',
      'google',
      'googleAiMode',
      'googleAio',
      'openai',
      'xai',
    ]);
    // Starter: ChatGPT and Gemini only.
    expect([...planEngineKeys(PLANS.starter.limits.allowedScrapers, [])].sort()).toEqual([
      'google',
      'openai',
    ]);
  });

  it('leaves out engines outside the plan, names them, and adds the plan’s engines without answers', () => {
    const keys = planEngineKeys(PLANS.growth.limits.allowedScrapers, []);
    const { rows, notInPlan } = breakdownForPlan(
      [row('ChatGPT'), row('Claude', 0, 0), row('Gemini'), row('Google AI Mode')],
      keys,
    );
    expect(rows.map((r) => [r.platform, !!r.noAnswers])).toEqual([
      ['ChatGPT', false],
      ['Gemini', false],
      ['Google AI Mode', false],
      ['Google AI Overviews', true],
      ['Grok', true],
      ['Microsoft Copilot', true],
    ]);
    expect(notInPlan).toEqual(['Claude']);
  });

  it('keeps every row with no plan (self-hosted)', () => {
    const { rows, notInPlan } = breakdownForPlan([row('Claude'), row('ChatGPT')], null);
    expect(rows.map((r) => r.platform)).toEqual(['Claude', 'ChatGPT']);
    expect(notInPlan).toEqual([]);
  });
});
