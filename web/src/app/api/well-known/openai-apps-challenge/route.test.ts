// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../../../../next.config';
import { GET } from './route';

/**
 * OpenAI's domain check for the ChatGPT app (#2141): the token from
 * OPENAI_APPS_CHALLENGE as plain text, at the root's /.well-known address
 * only, never cached; 404 while unset.
 */

afterEach(() => vi.unstubAllEnvs());

describe('GET /.well-known/openai-apps-challenge', () => {
  it('answers the token as plain text, exactly, never cached', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', 'oai-challenge-token-123');
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('oai-challenge-token-123');
  });

  it('leaves out the spaces and newline a pasted value carries', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', '  oai-challenge-token-123\n');
    expect(await GET().text()).toBe('oai-challenge-token-123');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', ' \n'],
  ])('answers 404 when %s', async (_name, value) => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', value);
    const res = GET();
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('Not found');
  });

  it('is served at the root only, by a rewrite to this handler', async () => {
    const rewrites = await nextConfig.rewrites!();
    const list = Array.isArray(rewrites)
      ? rewrites
      : [
          ...(rewrites.beforeFiles ?? []),
          ...(rewrites.afterFiles ?? []),
          ...(rewrites.fallback ?? []),
        ];
    const challenge = list.filter((r) => r.destination === '/api/well-known/openai-apps-challenge');
    expect(challenge.map((r) => r.source)).toEqual(['/.well-known/openai-apps-challenge']);
  });
});
