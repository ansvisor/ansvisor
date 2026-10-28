// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import {
  AUTHORS,
  DRAFT_ID,
  DRAFT_ROW,
  EXPECTED_HTML,
  JSON_LD_PARSED,
} from './__fixtures__/package-draft';

/**
 * get_content_draft_package (B5) on the server, where there is no browser
 * window: the editor's helpers read the page with jsdom's, and the page is
 * the one the editor's Send to CMS makes (content-package.editor.test.ts).
 */

let draft: Record<string, unknown> | null;
const draftFilters: [string, unknown][] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => (draftFilters.push([column, value]), chain),
        maybeSingle: async () => ({ data: draft, error: null }),
      };
      return chain;
    },
  },
}));
const readContentAuthors = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/authors-read', () => ({ readContentAuthors }));

const { getContentDraftPackageFor } = await import('./content-package');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

beforeEach(() => {
  draft = { ...DRAFT_ROW };
  draftFilters.length = 0;
  readContentAuthors.mockReset().mockResolvedValue(AUTHORS);
  // The authors, and so the byline, are read once Quality is live.
  vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getContentDraftPackageFor', () => {
  it('gives the page the editor’s Send to CMS makes, read with jsdom on the server', async () => {
    expect(typeof window).toBe('undefined');
    const result = await getContentDraftPackageFor(auth, DRAFT_ID);
    expect(result).toEqual({
      draft_id: DRAFT_ID,
      title: 'Cold brew at home: a slow, smooth coffee',
      slug: 'cold-brew-at-home',
      meta_title: 'Cold brew at home: a slow, smooth coffee',
      meta_description: 'Cold brew is coffee steeped in cold water for twelve to eighteen hours.',
      html: EXPECTED_HTML,
      json_ld: [JSON_LD_PARSED],
      author: 'Ada Lovelace',
      featured_image: { src: 'https://acme.example/cold-brew.jpg', alt: 'A jar of cold brew' },
      source_url: null,
    });
    expect(draftFilters).toContainEqual(['brands.organization_id', 'org-1']);
    expect(readContentAuthors).toHaveBeenCalledWith(expect.anything(), 'org-1', expect.anything());
  });

  it('cleans what a CMS mustn’t run, as the editor does', async () => {
    draft = {
      ...DRAFT_ROW,
      body_html:
        '<h1>Cold brew</h1><p onclick="steal()">Steep it slowly.<script>steal()</script></p>',
    };
    const result = await getContentDraftPackageFor(auth, DRAFT_ID);
    expect('html' in result && result.html).not.toMatch(/onclick|steal/);
  });

  it('says why a page can’t go yet', async () => {
    draft = {
      ...DRAFT_ROW,
      body_html: '<h1>Cold brew</h1><p>It steeps for [number] hours.</p>',
    };
    expect(await getContentDraftPackageFor(auth, DRAFT_ID)).toMatchObject({
      error: 'not_ready',
      problem: 'placeholders',
    });
  });

  it('finds no draft of another organization, nor an archived one', async () => {
    draft = null;
    expect(await getContentDraftPackageFor(auth, DRAFT_ID)).toMatchObject({ error: 'not_found' });
    draft = { ...DRAFT_ROW, archived_at: '2026-10-20T10:00:00Z' };
    expect(await getContentDraftPackageFor(auth, DRAFT_ID)).toMatchObject({ error: 'not_found' });
    expect(
      await getContentDraftPackageFor({ ...auth, organizationId: null }, DRAFT_ID),
    ).toMatchObject({ error: 'not_found' });
  });
});
