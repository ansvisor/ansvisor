export const dynamic = 'force-dynamic';

/**
 * OpenAI's domain check for Ansvisor's app in ChatGPT (MCP over OAuth,
 * #2141): OpenAI's portal gives a token, which it reads back as plain text at
 * the root's /.well-known/openai-apps-challenge (a next.config.ts rewrite;
 * the proxy skips any path with a dot). The token is OPENAI_APPS_CHALLENGE,
 * read per request rather than at build time: exactly the token, without the
 * spaces or newline a pasted value may carry. 404 while unset. Never cached,
 * so a new token counts as soon as it is deployed.
 */
const HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response('Not found', { status: 404, headers: HEADERS });
  return new Response(token, { status: 200, headers: HEADERS });
}
