import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { onBrandDomain } from '../lib/audit/host.js';
import { MAX_CONTENT_LENGTH, extractPageContent } from '../lib/page-content.js';
import { PageFetchError, fetchPage } from '../lib/safe-fetch.js';

/**
 * Pages brought into the Content Editor (CE-003): Optimize content › Page
 * URL, and Start's "Optimize this page instead". Only the brand's own pages
 * (its domains or their subdomains) are read: the editor optimizes the
 * brand's content, not anyone else's, and it keeps the fetch to sites the
 * brand named. The fetch itself refuses private addresses (safe-fetch.js).
 */

const router = Router();

const importBody = z.object({
  // guid, not uuid: brand ids aren't all RFC 4122 versions (seeded ones).
  brandId: z.guid(),
  url: z.string().trim().min(1).max(2048),
});

/** The person-facing reason a page couldn't be read, by fetch error code. */
const FETCH_STATUS = {
  invalid_url: 400,
  blocked: 400,
  too_many_redirects: 422,
  not_html: 422,
  too_large: 422,
  http_error: 422,
  timeout: 504,
  unreachable: 502,
};

router.post('/import', async (req, res) => {
  const parsed = importBody.safeParse(req.body);
  if (!parsed.success) {
    const urlIssue = parsed.error.issues.some((issue) => issue.path[0] === 'url');
    return res.status(400).json({ error: 'invalid', code: urlIssue ? 'invalid_url' : 'invalid' });
  }
  const { brandId } = parsed.data;
  // A bare host ("acme.com/pricing") is read as https.
  const url = /^[a-z][a-z0-9+.-]*:/i.test(parsed.data.url)
    ? parsed.data.url
    : `https://${parsed.data.url}`;

  try {
    await assertBrandAccess(brandId, req.user.id);
    const { data: domains, error } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId);
    if (error) throw error;
    const brandDomains = (domains ?? []).map((d) => d.domain);
    if (!onBrandDomain(url, brandDomains)) {
      return res.status(400).json({ error: 'Not on the brand’s site', code: 'off_site' });
    }

    const page = await fetchPage(url);
    // A redirect off the brand's site isn't the brand's page.
    if (!onBrandDomain(page.url, brandDomains)) {
      return res.status(422).json({ error: 'The page redirects off the site', code: 'off_site' });
    }
    const content = extractPageContent(page.html, page.url);
    if (content.html.length > MAX_CONTENT_LENGTH) {
      return res.status(422).json({ error: 'The page is too large', code: 'too_large' });
    }
    return res.json({ url: page.url, title: content.title, html: content.html });
  } catch (err) {
    if (err instanceof PageFetchError) {
      return res
        .status(FETCH_STATUS[err.code] ?? 502)
        .json({ error: err.message, code: err.code, status: err.status ?? null });
    }
    if (err?.status === 403 || err?.status === 404) {
      return res.status(err.status).json({ error: err.message, code: 'forbidden' });
    }
    req.log.error({ err }, 'content page import error');
    return res.status(500).json({ error: 'Failed to read the page', code: 'failed' });
  }
});

export default router;
