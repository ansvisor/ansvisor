import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
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
