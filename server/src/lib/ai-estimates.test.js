import { afterEach, describe, expect, it, vi } from 'vitest';

// The model choice reads no rows.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { aiEstimateCosts } = await import('./ai-estimates.js');
const { generationCostUsd } = await import('./improve-cost.js');

afterEach(() => vi.unstubAllEnvs());

describe('aiEstimateCosts', () => {
  it('prices Write this as a brief read, a page written and its searches, on the models that run them', () => {
    vi.stubEnv('CONTENT_READ_MODEL', 'anthropic/claude-haiku-5-5');
    vi.stubEnv('CONTENT_WRITE_MODEL', 'anthropic/claude-sonnet-5-5');
    const { writeThis } = aiEstimateCosts();
    const brief = generationCostUsd('anthropic/claude-haiku-5-5', {
      inputTokens: 12_000,
      outputTokens: 3_000,
    });
    const page = generationCostUsd('anthropic/claude-sonnet-5-5', {
      inputTokens: 20_000,
      outputTokens: 8_000,
    });
    expect(writeThis).toBeCloseTo(brief + page + 0.05, 6);
    // About 3% of Starter's $5: what its dialog says.
    expect((writeThis * 100) / 5).toBeGreaterThan(2);
    expect((writeThis * 100) / 5).toBeLessThan(5);
  });

  it('follows the write model a server runs on', () => {
    vi.stubEnv('CONTENT_READ_MODEL', 'anthropic/claude-haiku-5-5');
    vi.stubEnv('CONTENT_WRITE_MODEL', 'anthropic/claude-haiku-5-5');
    const cheaper = aiEstimateCosts().writeThis;
    vi.stubEnv('CONTENT_WRITE_MODEL', 'anthropic/claude-sonnet-5-5');
    expect(aiEstimateCosts().writeThis).toBeGreaterThan(cheaper);
  });
});

describe('the AI checks of a draft’s Site Audit estimate', () => {
  it('prices one call on the audit’s model', async () => {
    vi.stubEnv('AUDIT_LLM_MODEL', 'google/gemini-3-flash-preview');
    const { auditAiChecks } = aiEstimateCosts();
    expect(auditAiChecks).toBeCloseTo(
      generationCostUsd('google/gemini-3-flash-preview', {
        inputTokens: 4_000,
        outputTokens: 1_500,
      }),
      6,
    );
    // Under 1% of Starter's $5.
    expect((auditAiChecks * 100) / 5).toBeLessThan(1);
  });
});
