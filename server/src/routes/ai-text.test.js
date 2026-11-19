import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/** POST /api/ai-text/translate (LOC-010): checks the request, and asks as the caller. */

const translatedTexts = vi.hoisted(() => vi.fn());
vi.mock('../lib/ai-text-translate.js', () => ({
  MAX_ROWS: 50,
  TRANSLATABLE: { opportunity: {} },
  translatedTexts,
}));
const { default: router } = await import('./ai-text.js');

const O1 = '11111111-1111-4111-8111-111111111111';
let server;
let base;

beforeEach(async () => {
  translatedTexts.mockReset().mockResolvedValue({ [O1]: { title: 'Başlık' } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/ai-text', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/ai-text`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const post = (body) =>
  fetch(`${base}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/ai-text/translate', () => {
  it('translates the rows asked for, as the caller', async () => {
    const res = await post({ kind: 'opportunity', ids: [O1], locale: 'tr' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ texts: { [O1]: { title: 'Başlık' } } });
    expect(translatedTexts).toHaveBeenCalledWith({
      kind: 'opportunity',
      ids: [O1],
      locale: 'tr',
      userId: 'u1',
    });
  });

  it('refuses an unknown kind, a non-uuid id, too many rows or a bad locale', async () => {
    for (const body of [
      { kind: 'drafts', ids: [O1], locale: 'tr' },
      { kind: 'opportunity', ids: ['1'], locale: 'tr' },
      { kind: 'opportunity', ids: Array.from({ length: 51 }, () => O1), locale: 'tr' },
      { kind: 'opportunity', ids: [O1], locale: 'Turkish!' },
      { kind: 'opportunity', ids: [], locale: 'tr' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(translatedTexts).not.toHaveBeenCalled();
  });

  it('says it failed, never why, when the translation throws', async () => {
    translatedTexts.mockRejectedValue(new Error('db down'));
    const res = await post({ kind: 'opportunity', ids: [O1], locale: 'tr' });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to translate', code: 'failed' });
  });
});
