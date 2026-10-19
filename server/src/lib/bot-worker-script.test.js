import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_BOTS } from './ai-bots.js';
import { WORKER_BATCH, buildWorkerScript } from './bot-worker-script.js';

// The Worker runtime's fetch types, which Node also has.
const { Request, Response } = globalThis;

/**
 * The Cloudflare Worker (AT-010, spec §6.1 option A): passes every request
 * through and sends only AI-bot requests, in batches, to Ansvisor.
 */

async function loadWorker() {
  const script = buildWorkerScript({
    endpoint: 'https://api.example/bots/ingest',
    secret: 'abot_secret',
  });
  const mod = await import(`data:text/javascript,${encodeURIComponent(script)}`);
  return { script, worker: mod.default };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('buildWorkerScript', () => {
  it('names every bot on the list', async () => {
    const { script } = await loadWorker();
    for (const bot of AI_BOTS)
      expect(script).toContain(JSON.stringify(bot.userAgent.toLowerCase()));
  });

  it('passes requests through and sends the AI-bot ones in a batch', async () => {
    const sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        if (typeof input === 'string' && input.endsWith('/bots/ingest')) {
          sent.push({ init, body: JSON.parse(init.body) });
          return new Response('{}');
        }
        return new Response('page', { status: 200 });
      }),
    );
    const { worker } = await loadWorker();
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException: vi.fn() };

    const human = await worker.fetch(
      new Request('https://acme.example/', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/129' } }),
      {},
      ctx,
    );
    expect(await human.text()).toBe('page');
    expect(waits).toHaveLength(0);
    // A failure in the script still lets the request reach the site.
    expect(ctx.passThroughOnException).toHaveBeenCalled();

    for (let i = 0; i < WORKER_BATCH; i++) {
      await worker.fetch(
        new Request(`https://acme.example/menu?i=${i}`, {
          headers: {
            'user-agent': 'Mozilla/5.0; compatible; GPTBot/1.2',
            'cf-connecting-ip': '20.171.206.9',
          },
        }),
        {},
        ctx,
      );
    }
    // The 100th request sends the batch at once.
    await waits.at(-1);
    expect(sent).toHaveLength(1);
    expect(sent[0].init.headers.Authorization).toBe('Bearer abot_secret');
    expect(sent[0].body.requests).toHaveLength(WORKER_BATCH);
    expect(sent[0].body.requests[0]).toMatchObject({
      userAgent: 'Mozilla/5.0; compatible; GPTBot/1.2',
      ip: '20.171.206.9',
      // The page without its query string, which can carry personal data.
      url: 'https://acme.example/menu',
      status: 200,
    });
  });
});
