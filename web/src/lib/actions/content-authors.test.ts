import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Authors (CE-037): what the actions write. RLS decides who may
 * change an author or a brand's default; no row back is a refusal.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  filters: [string, unknown][];
}
let calls: Call[] = [];
/** What a write or read of each table answers. */
let answers: Record<string, { data: unknown; error: null | { message: string } }> = {};

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  const answer = () => answers[`${table}.${call.op}`] ?? { data: null, error: null };
  const chain = {
    select: () => chain,
    insert: (row: unknown) => Object.assign(call, { op: 'insert', row }) && chain,
    update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
    upsert: (row: unknown) => Object.assign(call, { op: 'upsert', row }) && chain,
    delete: () => Object.assign(call, { op: 'delete' }) && chain,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return chain;
    },
    order: () => chain,
    single: async () => answer(),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: builder,
  })),
}));

const { deleteContentAuthor, getContentAuthors, saveContentAuthor, setDefaultAuthor } =
  await import('./content-authors');

const writes = () => calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  calls = [];
  answers = {
    'profiles.select': { data: { organization_id: ORG, role: 'analyst' }, error: null },
    'content_authors.insert': { data: { id: ADA }, error: null },
    'content_authors.update': { data: { id: ADA }, error: null },
    'content_authors.delete': { data: [{ id: ADA }], error: null },
  };
});

describe('getContentAuthors', () => {
  it("reads the workspace's authors with the brands each is the default for", async () => {
    answers['content_authors.select'] = {
      data: [
        {
          id: ADA,
          name: 'Ada',
          title: null,
          bio: null,
          photo_url: null,
          same_as: null,
          user_id: ME,
        },
      ],
      error: null,
    };
    answers['brands.select'] = { data: [{ id: ACME, name: 'Acme' }], error: null };
    answers['content_author_defaults.select'] = {
      data: [{ brand_id: ACME, author_id: ADA }],
      error: null,
    };
    const read = await getContentAuthors();
    expect(read).toEqual({
      authors: [
        {
          id: ADA,
          name: 'Ada',
          title: null,
          bio: null,
          photoUrl: null,
          sameAs: [],
          userId: ME,
          defaultFor: [ACME],
        },
      ],
      brands: [{ id: ACME, name: 'Acme' }],
      me: { id: ME, role: 'analyst' },
    });
  });
});

describe('saveContentAuthor', () => {
  it('adds an author to the workspace, as the member when it is them', async () => {
    await saveContentAuthor({
      name: '  Ada Lovelace ',
      title: '',
      sameAs: ['https://x.com/ada', 'https://x.com/ada'],
      isMe: true,
    });
    expect(writes()).toEqual([
      {
        table: 'content_authors',
        op: 'insert',
        row: {
          name: 'Ada Lovelace',
          title: null,
          bio: null,
          photo_url: null,
          same_as: ['https://x.com/ada'],
          user_id: ME,
          organization_id: ORG,
          created_by: ME,
        },
        filters: [],
      },
    ]);
  });

  it('refuses a link that is not https, writing nothing', async () => {
    await expect(saveContentAuthor({ name: 'Ada', sameAs: ['http://x.com/ada'] })).rejects.toThrow(
      'invalid',
    );
    await expect(
      saveContentAuthor({ name: 'Ada', photoUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow('invalid');
    expect(writes()).toEqual([]);
  });

  it("saves an author, and unlinks the member's own when they untick it", async () => {
    await saveContentAuthor({ id: ADA, name: 'Ada', isMe: false });
    expect(writes()).toEqual([
      expect.objectContaining({ op: 'update', filters: [['id', ADA]] }),
      {
        table: 'content_authors',
        op: 'update',
        row: { user_id: null },
        filters: [
          ['id', ADA],
          ['user_id', ME],
        ],
      },
    ]);
    expect((writes()[0].row as Record<string, unknown>).user_id).toBeUndefined();
  });

  it('fails when RLS lets no row through', async () => {
    answers['content_authors.update'] = { data: null, error: null };
    await expect(saveContentAuthor({ id: ADA, name: 'Ada' })).rejects.toThrow('forbidden');
  });
});

describe('deleteContentAuthor', () => {
  it('deletes by id, and fails when nothing was deleted', async () => {
    await deleteContentAuthor(ADA);
    expect(writes()).toEqual([{ table: 'content_authors', op: 'delete', filters: [['id', ADA]] }]);
    answers['content_authors.delete'] = { data: [], error: null };
    await expect(deleteContentAuthor(ADA)).rejects.toThrow('forbidden');
    await expect(deleteContentAuthor('nope')).rejects.toThrow('invalid');
  });
});

describe('setDefaultAuthor', () => {
  it("sets a brand's default as the member, or clears it for the team byline", async () => {
    await setDefaultAuthor(ACME, ADA);
    expect(writes()[0]).toMatchObject({
      table: 'content_author_defaults',
      op: 'upsert',
      row: { brand_id: ACME, author_id: ADA, updated_by: ME },
    });
    await setDefaultAuthor(ACME, null);
    expect(writes()[1]).toEqual({
      table: 'content_author_defaults',
      op: 'delete',
      filters: [['brand_id', ACME]],
    });
  });
});
