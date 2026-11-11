import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Chat's PDF downloads (CHAT-06 item 32) render on the server with
  // @react-pdf/renderer, which reads Inter from public/fonts at run time:
  // the package stays outside the server bundle, and the fonts go with the
  // routes that write a PDF (Vercel serves public/ from its CDN only).
  serverExternalPackages: ['@react-pdf/renderer'],
  outputFileTracingIncludes: {
    '/api/chat/runs/[id]/export': ['./public/fonts/**/*'],
    '/api/chat/conversations/[id]/export': ['./public/fonts/**/*'],
    '/api/chat/runs/[id]/files/[n]': ['./public/fonts/**/*'],
    '/api/chat/files/[id]': ['./public/fonts/**/*'],
    '/api/chat/files/zip': ['./public/fonts/**/*'],
    // The free report card's PDF, for the API server's e-mail.
    '/api/internal/report-card/pdf': ['./public/fonts/**/*'],
  },
  // MCP over OAuth (#2141): the consent page is never framed (another site
  // can't overlay its Allow button), never cached, and sends no referrer to
  // the app it hands the person back to.
  async headers() {
    const consent = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
    ];
    return [
      { source: '/oauth/:path*', headers: consent },
      { source: '/en/oauth/:path*', headers: consent },
    ];
  },
  // MCP over OAuth (#2141): the discovery documents sit at the root's
  // /.well-known, where RFC 9728 and RFC 8414 put them, and so does OpenAI's
  // domain check for the ChatGPT app; their handlers are API routes. The
  // proxy skips both (a dot in the path, /api).
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource/api/mcp',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata' },
      {
        source: '/.well-known/openai-apps-challenge',
        destination: '/api/well-known/openai-apps-challenge',
      },
    ];
  },
  // The Prompts area has a route per view (PROMPT-001). Older links and
  // bookmarks — /dashboard/prompts and its ?tab= / ?view= shapes — land on
  // the matching route; their other query params come along.
  async redirects() {
    const base = '/dashboard/prompts';
    return [
      {
        source: base,
        has: [{ type: 'query', key: 'tab', value: 'fanout' }],
        destination: `${base}/fan-outs`,
        permanent: false,
      },
      {
        source: base,
        has: [{ type: 'query', key: 'tab', value: 'insights' }],
        destination: `${base}/insights`,
        permanent: false,
      },
      {
        source: base,
        has: [{ type: 'query', key: 'view', value: 'suggestions' }],
        destination: `${base}/suggestions`,
        permanent: false,
      },
      { source: base, destination: `${base}/tracked`, permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
