import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkFetchUrl, httpsGet, publicOnlyLookup } from './safe-fetch';

describe('which URLs are fetched', () => {
  it.each([
    'https://10.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/x',
    'https://[fd00::1]/x',
    'https://[::1]/x',
    'https://[::ffff:10.0.0.1]/x',
    // The URL parser turns these into 127.0.0.1.
    'https://2130706433/x',
    'https://0x7f.1/x',
    // A public IP too: a document's host is a name, checked by the lookup.
    'https://8.8.8.8/x',
  ])('refuses the IP host in %s', (value) => {
    expect(() => checkFetchUrl(value)).toThrow(expect.objectContaining({ code: 'blocked' }));
  });

  it('takes an https URL with a host name', () => {
    expect(checkFetchUrl('https://claude.ai/oauth/claude-code-client-metadata').host).toBe(
      'claude.ai',
    );
  });

  it.each([
    ['http://claude.ai/x', 'invalid_url'],
    ['https://claude.ai:8443/x', 'invalid_url'],
    ['https://u:p@claude.ai/x', 'invalid_url'],
  ])('refuses %s', (value, code) => {
    expect(() => checkFetchUrl(value)).toThrow(expect.objectContaining({ code }));
  });
});

describe('the request', () => {
  let server: http.Server;
  let base: string;
  const timers: NodeJS.Timeout[] = [];
  // Any address: the test server is on localhost.
  const anyLookup = publicOnlyLookup((_host, _opts, callback) =>
    callback(null, [{ address: '127.0.0.1', family: 4 }]),
  );
  const localLookup = ((
    _host: string,
    opts: { all?: boolean },
    callback: (err: null, address: unknown, family?: number) => void,
  ) =>
    opts?.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(null, '127.0.0.1', 4)) as unknown as ReturnType<typeof publicOnlyLookup>;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else if (req.url === '/trickle') {
        // A byte every 20 ms, forever: a socket's idle timeout never fires.
        res.writeHead(200, { 'content-type': 'application/json' });
        timers.push(setInterval(() => res.write(' '), 20));
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`"${'x'.repeat(20 * 1024)}"`);
      }
      // Anything else never answers.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const timer of timers) clearInterval(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const get = (path: string, timeoutMs = 2_000, lookup = localLookup) =>
    httpsGet(new URL(path, base), { request: http.request, lookup, timeoutMs });

  it('reads a document', async () => {
    const res = await get('/ok');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('{"ok":true}');
  });

  it('stops a server that never answers at the deadline', async () => {
    await expect(get('/hang', 100)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('stops a document that keeps trickling in at the deadline', async () => {
    const started = Date.now();
    await expect(get('/trickle', 200)).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('stops a document over 10 KB', async () => {
    await expect(get('/big')).rejects.toMatchObject({ code: 'too_large' });
  });

  it('connects only through the public-only lookup', async () => {
    // The default lookup sees localhost resolve to a private address.
    await expect(
      httpsGet(new URL('/ok', base), { request: http.request, timeoutMs: 2_000 }),
    ).rejects.toMatchObject({ code: 'blocked' });
    // A lookup that answers with a private address is refused as well.
    await expect(get('/ok', 2_000, anyLookup)).rejects.toMatchObject({ code: 'blocked' });
  });
});
