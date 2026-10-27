import { describe, expect, it, vi } from 'vitest';
import { FramerAPIError, FramerPluginClosedError, FramerPluginError } from 'framer-api';
import {
  FramerError,
  checkFieldMap,
  checkProject,
  collectionOf,
  listCollections,
  projectRef,
  withProject,
} from './framer.js';

/**
 * Framer's Server API for Send to CMS (#1331, phase 2): a project's address
 * read, a project and key checked before they're kept, and its collections
 * listed, against a fake of framer-api's connection (its answers as its
 * types describe them). Nothing here reaches Framer.
 */

const PROJECT = 'AbCdEfGhIj0123456789';
const KEY = 'fr_key_0123456789abcdefSECRET';

// `required` as framer-api has it: on the types that can be required only.
const field = (id, name, type, required) => ({
  id,
  name,
  type,
  ...(required === undefined ? {} : { required }),
});
const BLOG_FIELDS = [
  field('fTitle', 'Title', 'string', true),
  field('fDiv', '', 'divider'),
  field('fBody', 'Content', 'formattedText', false),
  field('fSeo', 'SEO Title', 'string', false),
  field('fCover', 'Cover', 'image', false),
  field('fOdd', 'Odd', 'unsupported'),
];
const collection = (id, name, managedBy, fields = BLOG_FIELDS, slugFieldBasedOn = 'fTitle') => ({
  id,
  name,
  managedBy,
  slugFieldBasedOn,
  getFields: vi.fn(async () => fields),
});

/** A project as framer-api opens it, and a connect that opens it. */
function fakeProject({
  allowed = true,
  production = { url: 'https://acme.framer.website/' },
  projectName = '  Acme Coffee ',
  userName = 'Ada Editor',
} = {}) {
  const framer = {
    disconnect: vi.fn(async () => {}),
    isAllowedTo: vi.fn(() => allowed),
    getProjectInfo: vi.fn(async () => ({ id: 'hashed-id', name: projectName })),
    getCurrentUser: vi.fn(async () => ({ id: 'u-hash', name: userName })),
    getPublishInfo: vi.fn(async () => ({ production, staging: null })),
    getCollections: vi.fn(async () => [
      collection('cBlog', 'Blog', 'user'),
      collection('cSynced', 'Synced', 'anotherPlugin'),
      collection('cMine', 'Mine', 'thisPlugin'),
      collection('cNews', 'News', 'user', [field('n1', 'Headline', 'string')], null),
    ]),
  };
  return { framer, connect: vi.fn(async () => framer) };
}

/** A promise settled from outside. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('projectRef', () => {
  it('reads the project’s id from its address, or takes the id itself', () => {
    expect(projectRef(PROJECT)).toBe(PROJECT);
    expect(projectRef(`  https://framer.com/projects/Acme-Site--${PROJECT}  `)).toBe(PROJECT);
    expect(projectRef(`https://www.framer.com/projects/Acme--${PROJECT}-x9Zq1?node=a1#b`)).toBe(
      PROJECT,
    );
    expect(projectRef(`framer.com/projects/${PROJECT}/`)).toBe(PROJECT);
    expect(projectRef(`https://framer.com/projects/My%20Site--${PROJECT}`)).toBe(PROJECT);
  });

  it('leaves a branch out: pages go to the main one', () => {
    expect(projectRef(`https://framer.com/projects/Acme--${PROJECT}?branch=feature-x`)).toBe(
      PROJECT,
    );
  });

  it('reads the id after the last "--" of a name that has more than one', () => {
    expect(projectRef(`https://framer.com/projects/Acme--Coffee--Blog--${PROJECT}`)).toBe(PROJECT);
    expect(projectRef(`https://framer.com/projects/A--B--${PROJECT}-x9Zq1`)).toBe(PROJECT);
  });

  it('refuses anything else before Framer is called', () => {
    for (const input of [
      '',
      'not a project',
      `http://framer.com/projects/Acme--${PROJECT}`,
      `https://evil.example/projects/Acme--${PROJECT}`,
      `https://framer.com.evil.example/projects/Acme--${PROJECT}`,
      `https://user:pw@framer.com/projects/Acme--${PROJECT}`,
      `https://framer.com:8443/projects/Acme--${PROJECT}`,
      `https://framer.com/sites/Acme--${PROJECT}`,
      'https://framer.com/projects/',
      'https://framer.com/projects/Acme--short1234',
      'AbCdEfGhIj012345678',
      'AbCdEfGhIj0123456789X',
      'https://framer.com/projects/%E0%A4%A',
    ]) {
      expect(() => projectRef(input), input).toThrow(FramerError);
      try {
        projectRef(input);
      } catch (err) {
        expect(err.code).toBe('invalid');
      }
    }
  });
});

describe('withProject', () => {
  it('connects with the project and key, runs, and closes the connection', async () => {
    const { framer, connect } = fakeProject();
    const result = await withProject(PROJECT, KEY, async (f) => f.getProjectInfo(), { connect });
    expect(result.name).toBe('  Acme Coffee ');
    expect(connect).toHaveBeenCalledWith(PROJECT, KEY);
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes the connection when the work fails, and a failed close changes nothing', async () => {
    const { framer, connect } = fakeProject();
    framer.disconnect.mockRejectedValue(new Error('socket gone'));
    await expect(
      withProject(
        PROJECT,
        KEY,
        async () => {
          throw new FramerAPIError('Node not found', 'NODE_NOT_FOUND');
        },
        { connect },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
    await expect(withProject(PROJECT, KEY, async () => 'done', { connect })).resolves.toBe('done');
  });

  it('says what Framer’s errors mean, in our words, never with the key', async () => {
    const cases = [
      ['UNAUTHORIZED', 'auth_failed'],
      ['PROJECT_CLOSED', 'not_found'],
      ['NODE_NOT_FOUND', 'not_found'],
      ['TOKEN_SESSION_LIMIT', 'busy'],
      ['POOL_EXHAUSTED', 'busy'],
      ['TIMEOUT', 'unreachable'],
      ['INVALID_REQUEST', 'invalid'],
      ['INTERNAL', 'failed'],
      ['EXPECTED_BRANCH_MISSING', 'failed'],
    ];
    for (const [framerCode, code] of cases) {
      const connect = vi.fn(async () => {
        throw new FramerAPIError(`Rejected token ${KEY} for ${PROJECT}`, framerCode);
      });
      const err = await withProject(PROJECT, KEY, async () => 'never', { connect }).catch((e) => e);
      expect(err, framerCode).toBeInstanceOf(FramerError);
      expect(err.code, framerCode).toBe(code);
      expect(err.message).not.toContain(KEY);
      expect(String(err.stack)).not.toContain(KEY);
    }
  });

  it('reads a project closed mid-call as a dropped connection, not a missing project', async () => {
    const { framer, connect } = fakeProject();
    const dropped = await withProject(
      PROJECT,
      KEY,
      async () => {
        throw new FramerAPIError('Connection closed', 'PROJECT_CLOSED');
      },
      { connect },
    ).catch((e) => e);
    expect(dropped).toMatchObject({
      code: 'unreachable',
      message: 'Framer closed the connection. Try again.',
    });
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
    const opening = vi.fn(async () => {
      throw new FramerAPIError(
        'Connection to the server was closed (code: 1006)',
        'PROJECT_CLOSED',
      );
    });
    await expect(
      withProject(PROJECT, KEY, async () => 'never', { connect: opening }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reads a refused call and a closed connection, without Framer’s message', async () => {
    const { connect } = fakeProject();
    const refused = await withProject(
      PROJECT,
      KEY,
      async () => {
        throw new FramerPluginError(`Not allowed for ${KEY}`);
      },
      { connect },
    ).catch((e) => e);
    expect(refused).toMatchObject({ code: 'failed' });
    expect(refused.message).not.toContain(KEY);
    const closed = await withProject(
      PROJECT,
      KEY,
      async () => {
        throw new FramerPluginClosedError('closed');
      },
      { connect },
    ).catch((e) => e);
    expect(closed).toMatchObject({ code: 'unreachable' });
  });

  it('lets an error of our own code through as it is', async () => {
    const { framer, connect } = fakeProject();
    const bug = new TypeError('x is not a function');
    await expect(
      withProject(
        PROJECT,
        KEY,
        async () => {
          throw bug;
        },
        { connect },
      ),
    ).rejects.toBe(bug);
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('gives up on a connection that doesn’t open in time, and closes it when it opens', async () => {
    const { framer } = fakeProject();
    const opening = deferred();
    const connect = vi.fn(() => opening.promise);
    const fn = vi.fn();
    const err = await withProject(PROJECT, KEY, fn, { connect, timeoutMs: 20 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'unreachable' });
    expect(framer.disconnect).not.toHaveBeenCalled();
    opening.resolve(framer);
    await vi.waitFor(() => expect(framer.disconnect).toHaveBeenCalledTimes(1));
    expect(fn).not.toHaveBeenCalled();
  });

  it('leaves no unhandled error behind a connection that opens or fails late', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { framer } = fakeProject();
      framer.disconnect.mockRejectedValue(new Error('socket gone'));
      const opening = deferred();
      const late = await withProject(PROJECT, KEY, vi.fn(), {
        connect: () => opening.promise,
        timeoutMs: 10,
      }).catch((e) => e);
      expect(late).toMatchObject({ code: 'unreachable' });
      opening.resolve(framer);
      await vi.waitFor(() => expect(framer.disconnect).toHaveBeenCalledTimes(1));
      const failing = deferred();
      await withProject(PROJECT, KEY, vi.fn(), {
        connect: () => failing.promise,
        timeoutMs: 10,
      }).catch(() => {});
      failing.reject(new FramerAPIError(`Unauthorized ${KEY}`, 'UNAUTHORIZED'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('gives up on work that doesn’t end in time, and closes the connection', async () => {
    const { framer, connect } = fakeProject();
    const err = await withProject(PROJECT, KEY, () => new Promise(() => {}), {
      connect,
      timeoutMs: 20,
    }).catch((e) => e);
    expect(err).toMatchObject({ code: 'unreachable' });
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('has nothing to close when the connection fails', async () => {
    const connect = vi.fn(async () => {
      throw new FramerAPIError('Unauthorized', 'UNAUTHORIZED');
    });
    await expect(withProject(PROJECT, KEY, async () => 'never', { connect })).rejects.toMatchObject(
      { code: 'auth_failed' },
    );
  });
});

describe('checkProject', () => {
  it('reads the project, the key’s user and the published address', async () => {
    const { framer, connect } = fakeProject();
    expect(await checkProject(PROJECT, KEY, { connect })).toEqual({
      projectId: PROJECT,
      projectName: 'Acme Coffee',
      account: 'Ada Editor',
      siteUrl: 'https://acme.framer.website',
    });
    expect(framer.isAllowedTo).toHaveBeenCalledWith(
      'Collection.addItems',
      'CollectionItem.setAttributes',
    );
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps no address for a project not published', async () => {
    const { connect } = fakeProject({ production: null });
    expect((await checkProject(PROJECT, KEY, { connect })).siteUrl).toBeNull();
  });

  it('keeps the published address as an https address, or none', async () => {
    const siteOf = async (url) =>
      (await checkProject(PROJECT, KEY, { connect: fakeProject({ production: { url } }).connect }))
        .siteUrl;
    expect(await siteOf('acme.framer.website')).toBe('https://acme.framer.website');
    expect(await siteOf('https://www.acme.example/blog/')).toBe('https://www.acme.example/blog');
    expect(await siteOf('http://acme.framer.website')).toBeNull();
    expect(await siteOf(`https://acme.example/${'a'.repeat(2048)}`)).toBeNull();
    expect(await siteOf('  ')).toBeNull();
  });

  it('cuts the names to what the row keeps', async () => {
    const { connect } = fakeProject({ projectName: 'P'.repeat(400), userName: 'U'.repeat(250) });
    const checked = await checkProject(PROJECT, KEY, { connect });
    expect(checked.projectName).toBe('P'.repeat(300));
    expect(checked.account).toBe('U'.repeat(200));
    const blank = fakeProject({ projectName: '   ', userName: null });
    expect(await checkProject(PROJECT, KEY, { connect: blank.connect })).toMatchObject({
      projectName: null,
      account: null,
    });
  });

  it('refuses a key whose user can’t edit the CMS', async () => {
    const { framer, connect } = fakeProject({ allowed: false });
    await expect(checkProject(PROJECT, KEY, { connect })).rejects.toMatchObject({
      code: 'no_access',
    });
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('leaves the edit check to the send when the connection can’t tell (framer-api 5.1.0)', async () => {
    const { framer, connect } = fakeProject();
    delete framer.isAllowedTo;
    expect((await checkProject(PROJECT, KEY, { connect })).projectName).toBe('Acme Coffee');
  });
});

describe('listCollections', () => {
  it('lists the user’s collections only, their fields as Framer types them, dividers left out', async () => {
    const { framer, connect } = fakeProject();
    expect(await listCollections(PROJECT, KEY, { connect })).toEqual([
      {
        id: 'cBlog',
        name: 'Blog',
        titleField: 'fTitle',
        fields: [
          { id: 'fTitle', name: 'Title', type: 'string', required: true },
          { id: 'fBody', name: 'Content', type: 'formattedText', required: false },
          { id: 'fSeo', name: 'SEO Title', type: 'string', required: false },
          { id: 'fCover', name: 'Cover', type: 'image', required: false },
          { id: 'fOdd', name: 'Odd', type: 'unsupported', required: false },
        ],
      },
      {
        id: 'cNews',
        name: 'News',
        titleField: null,
        fields: [{ id: 'n1', name: 'Headline', type: 'string', required: false }],
      },
    ]);
    expect(framer.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('collectionOf', () => {
  it('reads one of the user’s collections', async () => {
    const { connect } = fakeProject();
    expect(await collectionOf(PROJECT, KEY, 'cNews', { connect })).toMatchObject({
      id: 'cNews',
      name: 'News',
    });
  });

  it('finds none that is a plugin’s, or not the project’s', async () => {
    const { framer, connect } = fakeProject();
    for (const id of ['cSynced', 'cMine', 'cGone']) {
      await expect(collectionOf(PROJECT, KEY, id, { connect }), id).rejects.toMatchObject({
        code: 'not_found',
      });
    }
    expect(framer.disconnect).toHaveBeenCalledTimes(3);
  });
});

describe('checkFieldMap', () => {
  const fields = BLOG_FIELDS.filter((f) => f.type !== 'divider').map((f) => ({
    ...f,
    required: false,
  }));

  it('keeps a map that fits, the parts left empty out', () => {
    expect(
      checkFieldMap(
        { title: 'fTitle', body: 'fBody', metaTitle: 'fSeo', metaDescription: '', jsonLd: null },
        fields,
      ),
    ).toEqual({ ok: true, map: { title: 'fTitle', body: 'fBody', metaTitle: 'fSeo' } });
  });

  it('says which part doesn’t fit', () => {
    expect(checkFieldMap({ title: 'fBody', body: 'fTitle' }, fields)).toEqual({
      ok: false,
      problems: [
        'title: Content is formattedText, not string',
        'body: Title is string, not formattedText',
      ],
    });
    expect(checkFieldMap({ title: 'fTitle', body: 'fBody', metaTitle: 'fTitle' }, fields)).toEqual({
      ok: false,
      problems: ['metaTitle: Title already takes another part'],
    });
    expect(checkFieldMap({ title: 'fTitle', body: 'nope' }, fields)).toEqual({
      ok: false,
      problems: ['body: the collection has no field "nope"'],
    });
    expect(checkFieldMap({ jsonLd: 'fCover' }, fields)).toEqual({
      ok: false,
      problems: [
        'title: pick the text field a page’s title goes to',
        'body: pick the formatted text field a page goes to',
        'jsonLd: Cover is image, not string',
      ],
    });
  });

  it('keeps a map that fills every field the collection requires', () => {
    const required = fields.map((f) => (f.id === 'fTitle' ? { ...f, required: true } : f));
    expect(checkFieldMap({ title: 'fTitle', body: 'fBody' }, required)).toEqual({
      ok: true,
      map: { title: 'fTitle', body: 'fBody' },
    });
  });

  it('refuses a collection that requires a field Send to CMS doesn’t fill', () => {
    const required = fields.map((f) =>
      ['fCover', 'fSeo'].includes(f.id) ? { ...f, required: true } : f,
    );
    expect(checkFieldMap({ title: 'fTitle', body: 'fBody' }, required)).toEqual({
      ok: false,
      problems: [
        'The collection requires SEO Title, Cover, which Send to CMS doesn’t fill: make them optional in Framer, or pick another collection',
      ],
    });
    // A page may have no JSON-LD: the field it goes to can't be required.
    const cover = fields.map((f) => (f.id === 'fCover' ? { ...f, required: true } : f));
    const seo = fields.map((f) => (f.id === 'fSeo' ? { ...f, required: true } : f));
    expect(checkFieldMap({ title: 'fTitle', body: 'fBody' }, cover).problems).toEqual([
      'The collection requires Cover, which Send to CMS doesn’t fill: make it optional in Framer, or pick another collection',
    ]);
    expect(checkFieldMap({ title: 'fTitle', body: 'fBody', jsonLd: 'fSeo' }, seo).problems).toEqual(
      [
        'The collection requires SEO Title, which Send to CMS doesn’t fill: make it optional in Framer, or pick another collection',
      ],
    );
  });
});
