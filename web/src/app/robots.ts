import type { MetadataRoute } from 'next';

/**
 * Block search engines from indexing the application subdomain.
 *
 * The marketing site at `optumusanalytics.com` is hosted separately (Webflow) and
 * is the surface that should be indexed. The Next.js app at `app.optumusanalytics.com`
 * is purely the authenticated product UI and provides no value in search.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
