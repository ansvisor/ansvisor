import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The AI adoption rate behind every est_ai_volume: 45% of a prompt's Google
 * volume unless the install sets AI_VOLUME_MULTIPLIER.
 */
async function multiplier() {
  vi.resetModules();
  const { AI_VOLUME_MULTIPLIER } = await import('./intent-extraction.js');
  return AI_VOLUME_MULTIPLIER;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AI_VOLUME_MULTIPLIER', () => {
  it('defaults to 45% of Google volume', async () => {
    vi.stubEnv('AI_VOLUME_MULTIPLIER', '');
    expect(await multiplier()).toBe(0.45);
  });

  it('takes the rate an install sets', async () => {
    vi.stubEnv('AI_VOLUME_MULTIPLIER', '0.2');
    expect(await multiplier()).toBe(0.2);
  });
});
