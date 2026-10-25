import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Webflow for Send to CMS (#1331, phase 2): reading a site through Composio, and the field map. */

const executeWebflowTool = vi.fn();
vi.mock('../composio.js', () => ({
  executeWebflowTool: (...args) => executeWebflowTool(...args),
}));

const { WebflowError, checkFieldMap, getCollection, listCollections, listSites, suggestFieldMap } =
  await import('./webflow.js');

const account = { entityId: 'brand_b1', accountId: 'ca_1' };

// A Webflow blog collection's fields, as its template makes them.
const blog = [
  { slug: 'name', name: 'Name', type: 'PlainText', required: true },
  { slug: 'slug', name: 'Slug', type: 'PlainText', required: true },
  { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
  { slug: 'post-summary', name: 'Post Summary', type: 'PlainText', required: false },
  { slug: 'main-image', name: 'Main Image', type: 'Image', required: false },
  { slug: 'featured', name: 'Featured?', type: 'Switch', required: false },
];

beforeEach(() => executeWebflowTool.mockReset());

describe('reading the site', () => {
  it('lists the token’s sites, however Composio wraps them', async () => {
    executeWebflowTool.mockResolvedValueOnce({
      sites: [
        { id: 's1', displayName: 'Ansvisor', shortName: 'ansvisor' },
        { displayName: 'no id' },
      ],
    });
    expect(await listSites(account)).toEqual([{ id: 's1', name: 'Ansvisor' }]);
    expect(executeWebflowTool).toHaveBeenCalledWith('WEBFLOW_LIST_WEBFLOW_SITES', account, {});

    executeWebflowTool.mockResolvedValueOnce({
      response_data: { sites: [{ id: 's2', shortName: 'acme' }] },
    });
    expect(await listSites(account)).toEqual([{ id: 's2', name: 'acme' }]);
  });

  it('lists a site’s collections, and a collection’s fields a person can fill', async () => {
    executeWebflowTool.mockResolvedValueOnce({
      collections: [{ id: 'c1', displayName: 'Blog Posts', slug: 'post' }],
    });
    expect(await listCollections(account, 's1')).toEqual([
      { id: 'c1', name: 'Blog Posts', slug: 'post' },
    ]);
    expect(executeWebflowTool).toHaveBeenLastCalledWith('WEBFLOW_LIST_COLLECTIONS', account, {
      site_id: 's1',
    });

    executeWebflowTool.mockResolvedValueOnce({
      id: 'c1',
      displayName: 'Blog Posts',
      fields: [
        {
          slug: 'name',
          displayName: 'Name',
          type: 'PlainText',
          isRequired: true,
          isEditable: true,
        },
        { slug: 'post-body', displayName: 'Post Body', type: 'RichText', isEditable: true },
        { slug: 'created-on', displayName: 'Created On', type: 'DateTime', isEditable: false },
      ],
    });
    expect(await getCollection(account, 'c1')).toEqual({
      id: 'c1',
      name: 'Blog Posts',
      fields: [
        { slug: 'name', name: 'Name', type: 'PlainText', required: true },
        { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
      ],
    });
  });

  it('tells what went wrong in its own words, never Webflow’s', async () => {
    const said = async (message) => {
      executeWebflowTool.mockRejectedValueOnce(new Error(message));
      return listSites(account).catch((err) => err);
    };
    const refused = await said('Request failed with status 401: token wf_secret_123 is not valid');
    expect(refused).toBeInstanceOf(WebflowError);
    expect(refused).toMatchObject({ code: 'auth_failed' });
    expect(refused.message).not.toMatch(/wf_secret/);
    expect(await said('{"code":"missing_scopes","message":"cms:write"}')).toMatchObject({
      code: 'missing_scopes',
    });
    expect(await said('404 resource_not_found')).toMatchObject({ code: 'not_found' });
    expect(await said('socket hang up')).toMatchObject({ code: 'failed' });
    // A 403 is a site or collection the token doesn't reach, not a refused token.
    expect(await said('Request failed with status 403: forbidden')).toMatchObject({
      code: 'no_access',
    });
    // The brand's account gone at Composio: connecting again mends it.
    executeWebflowTool.mockRejectedValueOnce(
      Object.assign(new Error('No connected account ca_1'), {
        name: 'ComposioConnectedAccountNotFoundError',
      }),
    );
    expect(await listSites(account).catch((err) => err)).toMatchObject({ code: 'auth_failed' });
  });
});

describe('suggestFieldMap', () => {
  it('suggests the template’s fields by their names, one field a part', () => {
    expect(suggestFieldMap(blog)).toEqual({ body: 'post-body', metaDescription: 'post-summary' });
    expect(
      suggestFieldMap([
        ...blog,
        { slug: 'seo-title', name: 'SEO Title', type: 'PlainText' },
        { slug: 'meta-description', name: 'Meta Description', type: 'PlainText' },
        { slug: 'schema-markup', name: 'Schema markup', type: 'PlainText' },
      ]),
    ).toEqual({
      body: 'post-body',
      metaTitle: 'seo-title',
      metaDescription: 'meta-description',
      jsonLd: 'schema-markup',
    });
  });

  it('falls back to the first rich text for the body, and never suggests a field of another type', () => {
    expect(
      suggestFieldMap([
        { slug: 'intro', name: 'Intro', type: 'RichText' },
        { slug: 'summary-image', name: 'Summary image', type: 'Image' },
      ]),
    ).toEqual({ body: 'intro' });
    expect(suggestFieldMap([{ slug: 'name', name: 'Name', type: 'PlainText' }])).toEqual({});
  });
});

describe('checkFieldMap', () => {
  it('keeps a map that fits the collection', () => {
    expect(
      checkFieldMap({ body: 'post-body', metaDescription: 'post-summary', jsonLd: '' }, blog),
    ).toEqual({
      ok: true,
      map: { body: 'post-body', metaDescription: 'post-summary' },
    });
  });

  it('names each part that doesn’t fit', () => {
    const problems = (map, fields = blog) => checkFieldMap(map, fields).problems;
    expect(problems({ body: 'post-summary' })).toEqual([
      'body: Post Summary is PlainText, not RichText',
    ]);
    expect(problems({ body: 'post-body', metaTitle: 'nope' })).toEqual([
      'metaTitle: the collection has no field "nope"',
    ]);
    expect(problems({ body: 'post-body', metaTitle: 'name' })).toEqual([
      'metaTitle: the collection has no field "name"',
    ]);
    expect(
      problems({ body: 'post-body', metaTitle: 'post-summary', metaDescription: 'post-summary' }),
    ).toEqual(['metaDescription: Post Summary already takes another part']);
    expect(problems({ metaTitle: 'post-summary' })).toEqual([
      'body: pick the rich text field a page goes to',
    ]);
  });

  it('refuses a collection that requires a field Send to CMS doesn’t fill', () => {
    const fields = [
      ...blog,
      { slug: 'category', name: 'Category', type: 'Reference', required: true },
    ];
    expect(checkFieldMap({ body: 'post-body' }, fields).problems).toEqual([
      'The collection requires Category, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
    // A required field the map fills is fine.
    expect(
      checkFieldMap(
        { body: 'post-body' },
        blog.map((f) => (f.slug === 'post-body' ? { ...f, required: true } : f)),
      ).ok,
    ).toBe(true);
    // A page's meta description always has words (its opening ones at least);
    // its JSON-LD may be none.
    const summaryRequired = blog.map((f) =>
      f.slug === 'post-summary' ? { ...f, required: true } : f,
    );
    expect(
      checkFieldMap({ body: 'post-body', metaDescription: 'post-summary' }, summaryRequired).ok,
    ).toBe(true);
    expect(
      checkFieldMap({ body: 'post-body', jsonLd: 'post-summary' }, summaryRequired).problems,
    ).toEqual([
      'The collection requires Post Summary, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
  });
});
