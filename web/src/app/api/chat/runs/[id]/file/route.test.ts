// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Save to Files and Download on an answer (CHAT-06 items 32–37): a
 * read-only workspace can't file (402), a full one files nothing new (409),
 * a filed answer answers its file; a download names its file and is never
 * kept; an answer the person can't open is 404.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const RUN = '44444444-4444-4444-8444-444444444444';

const state = vi.hoisted(() => ({ refused: false }));
vi.mock('@/lib/subscription-guard', () => ({
  writeRefusal: async () =>
    state.refused
      ? NextResponse.json({ ok: false, code: 'subscription_inactive' }, { status: 402 })
      : null,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/run-api', async (original) => ({
  ...(await original<typeof import('@/lib/chat/run-api')>()),
  chatActor: async () => ACTOR,
}));
const files = vi.hoisted(() => ({
  saveRunAnswer: vi.fn(),
  readRunAnswer: vi.fn(),
}));
vi.mock('@/lib/chat/file-store', () => files);
const exporter = vi.hoisted(() => ({ exportAnswer: vi.fn() }));
vi.mock('@/lib/chat/export-file', () => exporter);

const fileRoute = await import('./route');
const exportRoute = await import('../export/route');

const params = (id = RUN) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.refused = false;
  files.saveRunAnswer.mockReset();
  files.readRunAnswer.mockReset();
  exporter.exportAnswer.mockReset();
});

describe('POST /api/chat/runs/{id}/file', () => {
  it('files the answer, and answers a filed one with its file', async () => {
    files.saveRunAnswer.mockResolvedValueOnce({
      ok: true,
      already: false,
      file: { id: 'f1', title: 'Why?' },
    });
    const res = await fileRoute.POST(new Request('http://x'), params());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, file: { id: 'f1' } });
    expect(files.saveRunAnswer).toHaveBeenCalledWith(ACTOR, RUN);

    files.saveRunAnswer.mockResolvedValueOnce({
      ok: true,
      already: true,
      file: { id: 'f1', title: 'Why?' },
    });
    expect((await fileRoute.POST(new Request('http://x'), params())).status).toBe(200);
  });

  it('refuses a read-only workspace, a full one, and an answer it can’t open', async () => {
    state.refused = true;
    expect((await fileRoute.POST(new Request('http://x'), params())).status).toBe(402);
    expect(files.saveRunAnswer).not.toHaveBeenCalled();
    state.refused = false;

    files.saveRunAnswer.mockResolvedValueOnce({ ok: false, failure: 'storage_full' });
    const full = await fileRoute.POST(new Request('http://x'), params());
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: 'storage_full' });

    files.saveRunAnswer.mockResolvedValueOnce({ ok: false, failure: 'not_found' });
    expect((await fileRoute.POST(new Request('http://x'), params())).status).toBe(404);
    expect((await fileRoute.POST(new Request('http://x'), params('nope'))).status).toBe(404);
  });
});

describe('GET /api/chat/runs/{id}/export', () => {
  const read = { answer: { markdown: 'Hi' } };

  it('downloads the format, named, never kept', async () => {
    files.readRunAnswer.mockResolvedValue(read);
    exporter.exportAnswer.mockResolvedValue({
      fileName: 'why-2026-10-30.md',
      contentType: 'text/markdown; charset=utf-8',
      body: new TextEncoder().encode('# Why'),
    });
    const res = await exportRoute.GET(
      new Request('https://app.example/api/chat/runs/x/export?format=md'),
      params(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="why-2026-10-30.md"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.text()).toBe('# Why');
    expect(files.readRunAnswer).toHaveBeenCalledWith(ACTOR, RUN, 'https://app.example');
  });

  it('refuses an unknown format, an answer it can’t open, and a format not offered', async () => {
    const get = (format: string) =>
      exportRoute.GET(new Request(`https://app.example/x?format=${format}`), params());
    expect((await get('exe')).status).toBe(400);
    files.readRunAnswer.mockResolvedValueOnce(null);
    expect((await get('pdf')).status).toBe(404);
    files.readRunAnswer.mockResolvedValueOnce(read);
    exporter.exportAnswer.mockResolvedValueOnce(null);
    expect((await get('csv')).status).toBe(404);
  });
});
