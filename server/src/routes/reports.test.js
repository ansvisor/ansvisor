import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * What the report summary's model is told (RP-01, RP-05): the headline is the
 * Visibility score out of 100, the prompt share is "Prompts with a mention",
 * and every engine reaches it by its display name, never as `gemini-web`.
 */

const generateText = vi.fn();
const assertBrandAccess = vi.fn();

function from() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { name: 'Brewline Coffee' }, error: null }),
  };
  return chain;
}

let server;
let baseUrl;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  generateText.mockResolvedValue({ text: '  The summary.  ' });
  assertBrandAccess.mockResolvedValue(undefined);
  vi.doMock('ai', () => ({ generateText }));
  vi.doMock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn(() => 'model') }));
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess }));
  vi.doMock('../config/supabase.js', () => ({ default: { from } }));

  const { default: router } = await import('./reports.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/reports', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/reports`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const snapshot = {
  brandName: 'Brewline Coffee',
  visibilityRate: { score: 15.5, ratePct: 36.4, visiblePrompts: 112, promptCount: 308 },
  insights: {
    avgVisibilityScore: 2.3,
    platformBreakdown: [
      { platform: 'gemini-web', avgScore: 3, resultCount: 10 },
      { platform: 'gpt-5-chat-latest', avgScore: 2, resultCount: 4 },
    ],
  },
  mentionEvidence: [{ promptText: 'best beans', platform: 'gemini-web', excerpt: '…' }],
  queryFanout: [{ query: 'espresso beans', engines: ['chatgpt-web', 'google-aio'] }],
  queryFanoutEngines: [{ engine: 'gemini-web', distinctQueries: 3, answersWithFanout: 2 }],
  aiTraffic: { platformBreakdown: [{ platform: 'chatgpt.com', visits: 9 }] },
};

async function summarize(body = { brandId: 'b1', snapshot }) {
  const res = await fetch(`${baseUrl}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /summary', () => {
  it('tells the model the headline is the Visibility score out of 100', async () => {
    const { status, body } = await summarize();
    expect(status).toBe(200);
    expect(body.summary).toBe('The summary.');
    const { system } = generateText.mock.calls[0][0];
    expect(system).toContain('The headline metric is the Visibility score, visibilityRate.score');
    expect(system).toContain('WITHOUT a % sign');
    expect(system).toContain('"Prompts with a mention"');
    expect(system).toContain('Never call it the visibility rate');
    // The stale rule that made the model quote ratePct as the headline.
    expect(system).not.toContain('that — not insights.avgVisibilityScore — is the headline');
  });

  it('sends engines by their display names, never their ids', async () => {
    await summarize();
    const { prompt } = generateText.mock.calls[0][0];
    expect(prompt).not.toMatch(/gemini-web|chatgpt-web|google-aio|gpt-5-chat-latest|chatgpt\.com/);
    const sent = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1));
    expect(sent.insights.platformBreakdown.map((p) => p.platform)).toEqual([
      'Gemini',
      'ChatGPT API',
    ]);
    expect(sent.mentionEvidence[0].platform).toBe('Gemini');
    expect(sent.queryFanout[0].engines).toEqual(['ChatGPT', 'Google AI Overviews']);
    expect(sent.queryFanoutEngines[0].engine).toBe('Gemini');
    expect(sent.aiTraffic.platformBreakdown[0].platform).toBe('ChatGPT');
    // The figures themselves go as they are.
    expect(sent.visibilityRate).toEqual(snapshot.visibilityRate);
  });

  it('refuses a request without a snapshot', async () => {
    const { status } = await summarize({ brandId: 'b1' });
    expect(status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });
});
